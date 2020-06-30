import _debug from "debug";
const debug = _debug("babbling:DisneyApp");

import { ILoadRequest, IMedia } from "nodecastor";

import { IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";

import { DisneyApi } from "./api";
import { DisneyPlayerChannel } from "./channel";
import { IDisneyOpts } from "./config";

export { IDisneyOpts } from "./config";

const APP_ID = "C3DE6BC2";

export class DisneyApp extends BaseApp {

    // declare Player support
    public static createPlayerChannel(options: IDisneyOpts) {
        return new DisneyPlayerChannel(options);
    }

    constructor(device: IDevice, private readonly options: IDisneyOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });
    }

    public async playById(
        entityId: string,
        opts: {
            language?: string,
            startTime?: number,
        } = {},
    ) {
        const language = opts.language || "en";

        const s = await this.ensureCastSession();

        const credentials = {
            accessState: JSON.stringify({
                contextState: {
                    modes: [ "bamIdentity" ],
                },
                refreshToken: this.options.refreshToken,
                token: this.options.token,
                version: "4.8",
            }),
        };

        const media: IMedia = {
            contentId: entityId,
            contentType: "application/x-mpegurl",
            streamType: "BUFFERED",

            // ?
            customData: {
                audioLanguage: language,
                dataSaver: "auto",
                subtitlesLanguage: language,
            },
        };

        const request: ILoadRequest = {
            autoplay: true,
            customData: {
                credentials,
                uiLanguage: language,
            },
            media,
            sessionId: s.id,
            type: "LOAD",
        };

        if (opts.startTime !== undefined) {
            request.currentTime = opts.startTime;
        }

        // send LOAD request!
        s.send(request);

        let ms;
        do {
            ms = await Promise.race([
                awaitMessageOfType(s, "CLOSE"),
                awaitMessageOfType(s, "LOAD_FAILED"),
                awaitMessageOfType(s, "MEDIA_STATUS"),
            ]);
            debug(ms);

            if (ms.type === "LOAD_FAILED") {
                throw new Error(`Load failed: ${ms.detailedErrorCode}`);
            }

        } while (!ms.status.length);

        debug("LOAD complete", ms.status[0].media);
    }

    public async playSeriesById(seriesId: string) {
        debug("find resume for series", seriesId);

        const api = new DisneyApi(this.options);
        const resume = await api.pickResumeEpisodeForSeries(seriesId);
        debug("... resume:", resume);

        await this.playById(resume.contentId);
    }

}
