/*
 * Based on https://github.com/ur1katz/casttube
 */

import request from "request-promise-native";

import _debug from "debug";
const debug = _debug("babbling:youtube");

import { ICastSession, IDevice } from "nodecastor";
import { IApp, IAppConstructor } from "../app";
import { BaseApp } from "./base";
import { awaitMessageOfType } from "./util";

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

export interface IYoutubeOpts {
    /**
     * A string of cookies as might be retrieved from the "copy as
     * cURL" from any request on youtube.com in Chrome's network
     * inspector
     */
    cookies?: string;

    /**
     * The name of the "device" to show when we connect to the
     * Chromecast. It will be rendered simply as "<deviceName>" at the
     * top of the screen, or "<owner>'s <deviceName> has joined" if
     * `cookies` is provided
     */
    deviceName?: string;
}

export class YoutubeApp extends BaseApp {

    private readonly cookies: string;
    private readonly bindData: typeof BIND_DATA;

    // youtube session state:
    private rid = 0;
    private nextRequestId = 0;
    private sid = "";
    private gsessionId: string | undefined;
    private loungeId: string | undefined;
    private existingScreen: string | undefined;

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

        // TODO support video URLs?
        await this.ensureYoutubeSession();
        await this.sessionRequest(URLS.bind, {
            data: {
                [KEYS.listId]: listId || "",
                [KEYS.action]: ACTIONS.setPlaylist,
                [KEYS.currentTime]: startTime === undefined || -1,
                [KEYS.currentIndex]: -1,
                [KEYS.audioOnly]: "false",
                [KEYS.videoId]: videoId,
                [KEYS.count]: 1,
            },
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
                    "cookie": this.cookies,
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
}
