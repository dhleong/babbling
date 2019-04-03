import _debug from "debug";
const debug = _debug("babbling:hbogo");

import { IDevice } from "nodecastor";
import { BaseApp } from "../base";
import { awaitMessageOfType } from "../util";

import { IQueryResult } from "../../app";
import { HboGoApi } from "./api";
import { HboGoConfigurable, IHboGoOpts } from "./config";
export { IHboGoOpts } from "./config";

const APP_ID = "144BDEF0";
const HBO_GO_NS = "urn:x-cast:hbogo";
const MEDIA_NS = "urn:x-cast:com.google.cast.media";

export interface IHboGoPlayOptions {
    /** Eg "ENG" */
    language?: string;
    showSubtitles?: boolean;

    /**
     * In seconds
     */
    startTime?: number;
}

export class HboGoApp extends BaseApp {

    public static configurable = new HboGoConfigurable();

    public static ownsUrl(url: string) {
        return url.includes("play.hbogo.com");
    }

    public static async createPlayable(url: string) {
        const urn = url.substring(url.lastIndexOf("/") + 1);
        try {
            const [ , , entityType ] = urn.split(":");

            switch (entityType) {
            case "series":
                return async (app: HboGoApp) => app.resumeSeries(urn);

            case "episode":
            case "extra":
            case "feature":
                // TODO: it may be possible to resume specific episodes or
                // features (movies)...
                return async (app: HboGoApp) => app.play(urn);
            }

        } catch (e) {
            throw new Error(`'${urn}' doesn't look playable`);
        }

        throw new Error(`Not sure how to play '${urn}'`);
    }

    public static async *queryByTitle(
        title: string,
        opts: IHboGoOpts,
    ): AsyncIterable<IQueryResult> {
        const api = new HboGoApi(opts.token.trim());
        for await (const result of api.search(title)) {
            const url = "https://play.hbogo.com/" + result.urn;
            yield {
                appName: "HboGoApp",
                playable: await HboGoApp.createPlayable(url),
                title: result.title,
                url,
            };
        }
    }

    private readonly api: HboGoApi;

    constructor(device: IDevice, options: IHboGoOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.api = new HboGoApi(options.token.trim());
    }

    /**
     * Play a URN that looks like, eg:
     *   urn:hbo:episode:GVU3WpwOjOYNJjhsJAX5-
     */
    public async play(
        urn: string,
        options: IHboGoPlayOptions = {},
    ) {
        const {
            deviceId,
            userTkey,
        } = this.api.extractTokenInfo();

        const [ refreshToken, s ] = await Promise.all([
            this.api.getRefreshToken(),
            this.ensureCastSession(),

            // stop other concurrent streams? (the web app does it)
            this.api.stopConcurrentStreams(),
        ]);

        debug("Joined media session", s.id);

        const hbogo = await this.joinOrRunNamespace(HBO_GO_NS);

        s.send({
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
            sessionId: s.id,
            type: "LOAD",
        });

        let ms;
        do {
            ms = await awaitMessageOfType(s, "MEDIA_STATUS");
            debug(ms);
        } while (!ms.status.length);

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
