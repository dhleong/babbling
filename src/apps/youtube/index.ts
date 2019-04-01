/*
 * Based on https://github.com/ur1katz/casttube
 */

import request from "request-promise-native";
import URL from "url";

import _debug from "debug";
const debug = _debug("babbling:youtube");

import { ICastSession, IDevice } from "nodecastor";
import { ICreds, WatchHistory, YoutubePlaylist } from "youtubish";

import { IApp, IAppConstructor, IPlayableOptions } from "../../app";
import { BaseApp } from "../base";
import { awaitMessageOfType } from "../util";
import { IPlaylistCache, IYoutubeOpts, YoutubeConfigurable } from "./config";

export { IYoutubeOpts } from "./config";

const APP_ID = "233637DE";
const MDX_NS = "urn:x-cast:com.google.youtube.mdx";

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

export class YoutubeApp extends BaseApp {

    public static configurable = new YoutubeConfigurable();

    public static ownsUrl(url: string) {
        return url.includes("youtube.com") || url.includes("youtu.be");
    }

    public static async createPlayable(url: string, options?: IYoutubeOpts) {
        let videoId = "";
        let listId = "";
        let startTime = -1;

        const parsed = URL.parse(url, true);

        if (url.startsWith("youtu.be")) {
            videoId = url.substring(url.lastIndexOf("/") + 1);
            debug("got short URL video id", videoId);
        } else if (parsed.query.v) {
            videoId = parsed.query.v as string;
            debug("got video id", videoId);
        }

        if (parsed.query.list) {
            listId = parsed.query.list as string;
            debug("extracted listId", listId);

            // watch later requires auth
            if (listId === "WL" && !(options && options.cookies)) {
                throw new Error("Cannot use watch later playlist without cookies");
            }
        }

        if (parsed.query.t) {
            startTime = parseInt(parsed.query.t as string, 10);
            debug("detected start time", startTime);
        }

        if (listId === "" && videoId === "") {
            throw new Error(`Not sure how to play '${url}'`);
        }

        return async (app: YoutubeApp, opts: IPlayableOptions) => {
            if (
                opts.resume !== false
                && app.youtubish
                && listId !== ""
                && videoId === ""
            ) {
                return app.resumePlaylist(listId);
            }

            return app.play(videoId, {
                listId,
                startTime,
            });
        };
    }

    private cookies: string;
    private readonly bindData: typeof BIND_DATA;

    // youtube session state:
    private rid = 0;
    private nextRequestId = 0;
    private sid = "";
    private gsessionId: string | undefined;
    private loungeId: string | undefined;
    private existingScreen: string | undefined;

    // youtubish state
    private readonly youtubish: ICreds | undefined;
    private readonly playlistsCache: IPlaylistCache | undefined;

    constructor(device: IDevice, options: IYoutubeOpts = {}) {
        super(device, {
            appId: APP_ID,
            sessionNs: MDX_NS,
        });

        this.cookies = "";
        if (options && options.cookies) {
            const { cookies } = options;
            if (typeof cookies !== "string") {
                throw new Error("Invalid cookies format");
            }

            this.cookies = cookies;
        }

        this.bindData = Object.assign({}, BIND_DATA);
        if (options && options.deviceName) {
            this.bindData.name = options.deviceName;
        }

        if (options && options.youtubish) {
            this.youtubish = options.youtubish;
            this.playlistsCache = options.playlistsCache;
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
     * Requires Youtubish credentials
     */
    public async resumePlaylist(id: string) {
        if (!this.youtubish) {
            throw new Error("Cannot resume playlist without youtubish credentials");
        }

        debug("attempting to resume playlist", id);
        const playlist = this.playlistById(id);
        const video = await playlist.findMostRecentlyPlayed(
            new WatchHistory(this.youtubish),
        );

        debug("Resuming playlist", id, "at", video);
        return this.play(video.id, {
            listId: id,
        });
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
            return await request.post({
                form: data,
                headers: {
                    "X-YouTube-LoungeId-Token": this.loungeId,
                    "cookie": await this.getCookies(),
                    "origin": YOUTUBE_BASE_URL,
                },
                json: !isBind,
                qs,
                url,
            });
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
        if (this.cookies) return this.cookies;
        if (!this.youtubish) return undefined;

        if (this.youtubish instanceof Promise) {
            const filled = await this.youtubish;
            this.cookies = filled.cookies;
            return filled.cookies;
        }
    }

    private playlistById(id: string) {
        if (!this.youtubish) {
            throw new Error("Cannot resume playlist without youtubish credentials");
        }

        // TODO probably, expire cache periodically
        if (this.playlistsCache && this.playlistsCache[id]) {
            debug("Reusing playlist from cache", id);
            return this.playlistsCache[id] as YoutubePlaylist;
        } else {
            const playlist = new YoutubePlaylist(this.youtubish, id);
            debug("Fresh playlist", id);

            if (this.playlistsCache) {
                this.playlistsCache[id] = playlist;
            }
            return playlist;
        }
    }
}
