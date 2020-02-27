/*
 * Based on https://github.com/ur1katz/casttube
 */

import { CookieJar } from "request";
import request from "request-promise-native";
import tough from "tough-cookie";

import _debug from "debug";
const debug = _debug("babbling:youtube");

import { ICreds, WatchHistory, YoutubePlaylist } from "youtubish";
import { isCredentials, isCredentialsPromise } from "youtubish/dist/creds";

import { IVideo } from "youtubish/dist/model";
import { ICastSession, IDevice } from "../../cast";
import { read, Token, write } from "../../token";
import { BaseApp } from "../base";
import { awaitMessageOfType } from "../util";

import { YoutubePlayerChannel } from "./channel";
import { IYoutubeOpts, YoutubeConfigurable } from "./config";

export { IYoutubeOpts } from "./config";

const APP_ID = "233637DE";
const MDX_NS = "urn:x-cast:com.google.youtube.mdx";

const COOKIES_DOMAIN = "https://youtube.com/";
const YOUTUBE_BASE_URL = "https://www.youtube.com/";
const URLS = {
    bind: YOUTUBE_BASE_URL + "api/lounge/bc/bind",
    loungeToken: YOUTUBE_BASE_URL + "api/lounge/pairing/get_lounge_token_batch",
};

const BIND_DATA = {
    "app": "android-phone-13.14.55",
    "device": "REMOTE_CONTROL",
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
    "mdx-version": 3,
    "name": "Babbling App",
    "pairing_type": "cast",
};

const KEYS = {
    action: "__sc",
    audioOnly: "_audioOnly",
    count: "count",
    currentIndex: "_currentIndex",
    currentTime: "_currentTime",
    listId: "_listId",
    list_id: "_listId",
    videoId: "_videoId",
};

const ACTIONS = {
    add: "addVideo",
    clear: "clearPlaylist",
    insert: "insertVideo",
    remove: "removeVideo",
    setPlaylist: "setPlaylist",
};
type Action = keyof typeof ACTIONS;

const GSESSION_ID_REGEX = /"S","(.*?)"]/;
const SID_REGEX = /"c","(.*?)","/;

async function getMdxScreenId(session: ICastSession) {
    session.send({ type: "getMdxSessionStatus" });
    const status = await awaitMessageOfType(session, "mdxSessionStatus");
    return status.data.screenId;
}

export type VideoFilter = (v: IVideo) => boolean;

export function fillJar(
    url: string,
    jar: CookieJar,
    cookieString: string,
) {
    for (const part of cookieString.split(";")) {
        const cookie = tough.Cookie.parse(part);
        if (!cookie) throw new Error();

        cookie.expires = "Infinity";
        jar.setCookie(cookie, url);
    }
}

export function pruneCookies(
    cookiesString: string,
) {
    if (!cookiesString.includes("LOGIN_INFO=")) return;

    // NOTE: it seems we don't want to persist this...?
    return cookiesString.replace(/S=youtube_lounge_remote=[^;]+(;|$)/, "").trim()
        .replace(/;$/, "");
}

export function extractCookies(
    jar: CookieJar,
) {
    const newCookies = jar.getCookieString(COOKIES_DOMAIN);
    if (!newCookies || !newCookies.length) return;
    return pruneCookies(newCookies);
}

export class YoutubeApp extends BaseApp {

    public static tokenConfigKeys = [ "cookies" ];
    public static configurable = YoutubeConfigurable;
    public static createPlayerChannel(options: IYoutubeOpts = {}) {
        return new YoutubePlayerChannel(options);
    }

    private cookies: Token;
    private readonly bindData: typeof BIND_DATA;
    private readonly jar: CookieJar;

    // youtube session state:
    private rid = 0;
    private nextRequestId = 0;
    private sid = "";
    private gsessionId: string | undefined;
    private loungeId: string | undefined;
    private existingScreen: string | undefined;

    // youtubish state
    private readonly youtubish: ICreds | undefined;

    constructor(device: IDevice, options: IYoutubeOpts = {}) {
        super(device, {
            appId: APP_ID,
            sessionNs: MDX_NS,
        });

        this.jar = request.jar();

        this.cookies = "";
        if (options && options.cookies) {
            const cookies = read(options.cookies);
            if (typeof cookies !== "string") {
                throw new Error("Invalid cookies format");
            }

            this.cookies = options.cookies;

            this.youtubish = { cookies };
        } else if (options.youtubish) {
            this.youtubish = options.youtubish;
        }

        this.bindData = Object.assign({}, BIND_DATA);
        if (options && options.deviceName) {
            this.bindData.name = options.deviceName;
        }
    }

    /**
     * Options:
     * - listId: Id of playlist to enqueue. The given `videoId` should
     *   probably be a member of this playlist
     * - startTime: Time in seconds to start playback. Defaults to -1
     *   which resumes wherever the active user (if cookies were
     *   supplied) left off.
     */
    public async play(
        videoId: string,
        options: {
            listId?: string,
            startTime?: number,
        } = {},
    ) {
        const { listId, startTime } = options;

        if (
            videoId === ""
            && listId
            && listId.length
            && this.youtubish
        ) {
            // starting a playlist works best when we actually
            // load the first video in it (if we can)
            try {
                const video = await this.playlistById(listId).get(0);
                videoId = video.id;
            } catch (e) {
                // ignore; this is best-effort
                debug(`Failed to load playlist '${listId}':`, e);
            }
        }

        await this.ensureYoutubeSession();
        await this.sessionRequest(URLS.bind, {
            data: {
                [KEYS.listId]: listId || "",
                [KEYS.action]: ACTIONS.setPlaylist,
                [KEYS.currentTime]: startTime === undefined ? -1 : startTime,
                [KEYS.currentIndex]: -1,
                [KEYS.audioOnly]: "false",
                [KEYS.videoId]: videoId,
                [KEYS.count]: 1,
            },
        });
    }

    /**
     * Play the given playlist. By default, we start with the first
     * video in the playlist, but you can provide an index into the
     * playlist via the options map
     *
     * @param filter If provided, a predicate function that must return True
     * for a video in the playlist to be considered for playback
     */
    public async playPlaylist(
        id: string,
        options: {
            filter?: VideoFilter,
            index?: number;
        } = {},
    ) {
        debug(`attempting to play playlist ${id} at (index: ${options.index})`);
        return this.playItemInPlaylist(
            id,
            options.filter,
            playlist => playlist.get(options.index || 0),
        );
    }

    /**
     * Requires Youtubish credentials
     *
     * @param filter If provided, a predicate function that must return True
     * for a video in the playlist to be considered for playback
     */
    public async resumePlaylist(
        id: string,
        options: {
            filter?: VideoFilter,
        } = {},
    ) {
        const creds = this.youtubish;
        if (!creds) {
            throw new Error("Cannot resume playlist without youtubish credentials");
        }

        debug("attempting to resume playlist", id);
        return this.playItemInPlaylist(
            id,
            options.filter,
            playlist => playlist.findMostRecentlyPlayed(
                new WatchHistory(creds),
            ),
        );
    }

    /**
     * Add a video to the end of the queue
     */
    public async addToQueue(videoId: string) {
        await this.queueAction(videoId, "add");
    }

    public async playNext(videoId: string) {
        await this.queueAction(videoId, "insert");
    }

    public async playVideo(videoId: string) {
        await this.queueAction(videoId, "remove");
    }

    public async clearPlaylist() {
        await this.queueAction("", "clear");
    }

    public isAuthenticated(): boolean {
        return !!this.youtubish;
    }

    private async playItemInPlaylist(
        playlistId: string,
        filter: VideoFilter | undefined,
        selector: (playlist: YoutubePlaylist) => Promise<IVideo>,
    ) {
        let playlist = this.playlistById(playlistId);

        if (filter) {
            playlist = playlist.filter(filter);
        }

        const video = await selector(playlist);

        debug("playing playlist", playlistId, "at", video);
        return this.play(video.id, {
            listId: playlistId,
        });
    }

    private get inSession() {
        return this.loungeId && this.gsessionId;
    }

    private async ensureYoutubeSession() {
        if (this.inSession) {
            return;
        }

        await this.ensureLoungeId();
        await this.bind();
    }

    private async ensureLoungeId() {
        const s = await this.ensureCastSession();
        const screenId = await getMdxScreenId(s);

        const existing = this.loungeId;
        if (existing && this.existingScreen === screenId) {
            return existing;
        }

        const response = await request.post({
            form: {
                screen_ids: screenId,
            },
            json: true,
            url: URLS.loungeToken,
        });

        debug("loungeIdResponse:", response);

        const token = response.screens[0].loungeToken;
        this.loungeId = token;
        this.existingScreen = screenId;

        return token;
    }

    private async bind() {
        this.rid = 0;
        this.nextRequestId = 0;

        const r = await this.sessionRequest(URLS.bind, {
            data: this.bindData,
            isBind: true,
        });

        debug("bind response", r);

        const [ , sid ] = r.match(SID_REGEX);
        const [ , gsessionId ] = r.match(GSESSION_ID_REGEX);

        this.sid = sid;
        this.gsessionId = gsessionId;

        debug("got sid=", sid, "gsid=", gsessionId);
    }

    private async queueAction(
        videoId: string,
        actionKey: Action,
    ) {

        // If nothing is playing actions will work but won"t affect the queue.
        // This is for binding existing sessions
        if (!this.inSession) {
            await this.ensureYoutubeSession();
        } else {
            // There is a bug that causes session to get out of sync after about 30 seconds. Binding again works.
            // Binding for each session request has a pretty big performance impact
            await this.bind();
        }

        const action = ACTIONS[actionKey];
        await this.sessionRequest(URLS.bind, {
            data: {
                [KEYS.action]: action,
                [KEYS.videoId]: videoId,
                [KEYS.count]: 1,
            },
        });
    }

    private async sessionRequest(
        url: string,
        {data, isBind}: {
            data: any,
            isBind?: boolean,
        },
    ) {
        const qs = {
            CVER: 1,
            RID: this.rid++,
            VER: 8,
        } as any;

        if (!isBind) {
            const reqId = this.nextRequestId++;
            const reqPrefix = `req${reqId}`;

            data = Object.keys(data).reduce((m, k) => {
                if (k.startsWith("_")) {
                    m[reqPrefix + k] = data[k];
                } else {
                    m[k] = data[k];
                }
                return m;
            }, {} as any);

            qs.SID = this.sid;
            qs.gsessionid = this.gsessionId;
        }

        try {
            const cookies = await this.getCookies();

            // attempt to load cookies if we haven't already
            if (
                cookies
                && !this.jar.getCookies(COOKIES_DOMAIN).length
            ) {
                fillJar(COOKIES_DOMAIN, this.jar, cookies);
                debug("filled jar with", this.jar.getCookies(COOKIES_DOMAIN).length);
            }

            const response = await request.post({
                form: data,
                headers: {
                    "X-YouTube-LoungeId-Token": this.loungeId,
                    "cookie": cookies,
                    "origin": YOUTUBE_BASE_URL,
                },
                jar: this.jar,
                json: !isBind,
                qs,
                url,

                resolveWithFullResponse: true,
            });

            debug(response.body, response.headers);
            const result = response.body;

            // on a successful request, update cookies
            if (typeof this.cookies !== "string") {
                const newCookies = extractCookies(this.jar);
                if (
                    newCookies
                    && newCookies !== read(this.cookies)
                ) {
                    debug("updated cookies <- ", newCookies);
                    await write(this.cookies, newCookies);
                }
            }

            return result;
        } catch (e) {
            debug(e);

            // 404 resets the sid, session counters
            // 400 in session probably means bad sid
            // If user did a bad request (eg. remove an non-existing video from queue) bind restores the session.
            if (
                e.response.statusCode === 400
                || e.response.statusCode === 404
            ) {
                await this.bind();
            }

            if (e.response.statusCode === 410) {
                debug("input data", data);
                throw new Error("No such video");
            }

            throw e;
        }
    }

    private async getCookies() {
        const readCookies = read(this.cookies);
        if (readCookies) return readCookies;

        const youtubish = this.youtubish;
        if (!youtubish) return undefined;

        if (isCredentialsPromise(youtubish)) {
            const filled = await youtubish;
            this.cookies = filled.cookies;
            return filled.cookies;
        }

        if (isCredentials(youtubish)) {
            return youtubish.cookies;
        }

        const creds = await youtubish.get();
        if (creds) return creds.cookies;
    }

    private playlistById(id: string) {
        if (!this.youtubish) {
            throw new Error("Cannot resume playlist without youtubish credentials");
        }

        return new YoutubePlaylist(this.youtubish, id);
    }
}
