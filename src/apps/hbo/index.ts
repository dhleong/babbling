import _debug from "debug";

import { ChromecastDevice } from "stratocaster";

import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";
import { ILoadRequest } from "../../cast";

import { HboApi } from "./api";
import { HboPlayerChannel } from "./channel";
import { HboConfigurable, IHboOpts } from "./config";

const debug = _debug("babbling:hbo");
export { IHboOpts } from "./config";

const APP_ID = "144BDEF0";
const HBO_GO_NS = "urn:x-cast:hbogo";

export interface IHboPlayOptions {
    /** Eg "ENG" */
    language?: string;
    showSubtitles?: boolean;

    /**
     * In seconds
     */
    startTime?: number;
}

export class HboApp extends BaseApp {
    public static tokenConfigKeys = ["token"];
    public static configurable = new HboConfigurable();
    public static createPlayerChannel(options: IHboOpts) {
        return new HboPlayerChannel(options);
    }

    private readonly api: HboApi;

    constructor(device: ChromecastDevice, options: IHboOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.api = new HboApi(options.token);
    }

    /**
     * Play a URN that looks like, eg:
     *   urn:hbo:episode:GVU3WpwOjOYNJjhsJAX5-
     */
    public async play(
        urn: string,
        options: IHboPlayOptions = {},
    ) {
        const {
            deviceId,
            userTkey,
        } = await this.api.extractTokenInfo();

        const [refreshToken, s] = await Promise.all([
            this.api.getRefreshToken(),
            this.ensureCastSession(),

            // stop other concurrent streams? (the web app does it)
            this.api.stopConcurrentStreams(),
        ]);

        debug("Joined media session", s.destination);

        const hbogo = await this.joinOrRunNamespace(HBO_GO_NS);
        const req: ILoadRequest = {
            autoplay: true,
            customData: {
                algorithm: "adaptive",
                authToken: {
                    refresh_token: refreshToken,
                },
                ccProperties: {
                    backgroundColor: "#000000",
                    backgroundOpacity: 0.33,
                    fontColor: "#FFFFFF",
                    fontFamily: 4,
                    fontOpacity: 1,
                    fontSize: 100,
                    fontStyle: "",
                },

                deviceId,
                displayCC: options.showSubtitles || false,
                featureTkey: urn,
                isExtra: urn.includes(":extra:"),
                isFree: false, // ?
                isPreview: false, // ?
                language: options.language || "ENG",
                position: options.startTime,
                userTkey,

                // senderSessionId: "", // what should go here?
            },
            media: {
                contentId: urn,
                contentType: "video/mp4",
                streamType: "BUFFERED",
            },
            sessionId: s.destination ?? "",
            type: "LOAD",
        };

        const ms = await s.send(req as any);
        debug(ms);

        let ps;
        do {
            ps = await awaitMessageOfType(hbogo, "PLAYERSTATE");
            debug(ps);
        } while (!ps.success);

        if (ps.playerState === "APPLICATION_ERROR") {
            throw new Error("Error");
        }

        debug("Done!");
    }

    /**
     * Attempt to resume the series with the given `urn`.
     */
    public async resumeSeries(urn: string) {
        const info = await this.api.fetchNextEpisodeForSeries(urn);
        debug(`found next episode for '${urn}':`, info);

        return this.play(info.urn, {
            startTime: info.position,
        });
    }
}
