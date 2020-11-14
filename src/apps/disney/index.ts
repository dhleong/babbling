import _debug from "debug";
const debug = _debug("babbling:DisneyApp");

import { BaseApp, MEDIA_NS } from "../base";
import { ILoadRequest, IMedia } from "../../cast";

import { DisneyApi } from "./api";
import { DisneyPlayerChannel } from "./channel";
import { DisneyConfigurable, IDisneyOpts } from "./config";
import { IPlayableOptions } from "../../app";
import { ChromecastDevice } from "stratocaster";

export { IDisneyOpts } from "./config";

const APP_ID = "C3DE6BC2";

export class DisneyApp extends BaseApp {

    // declare Player support
    public static tokenConfigKeys = [ "token", "refreshToken" ];
    public static configurable = new DisneyConfigurable();
    public static createPlayerChannel(options: IDisneyOpts) {
        return new DisneyPlayerChannel(options);
    }

    constructor(device: ChromecastDevice, private readonly options: IDisneyOpts) {
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

        const [s, credentials] = await Promise.all([
            this.ensureCastSession(),
            this.loadCredentials(),
        ]);

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
            sessionId: s.destination!!,
            type: "LOAD",
        };

        if (opts.startTime !== undefined) {
            request.currentTime = opts.startTime;
        }

        // send LOAD request!
        const ms = await s.send(request as any);
        if (ms.type !== "MEDIA_STATUS") {
            throw new Error(`Load failed: ${ms}`);
        }

        debug("LOAD complete", (ms as any).status[0].media);
    }

    public async playSeriesById(
        seriesId: string,
        opts: IPlayableOptions = {},
    ) {
        debug("find resume for series", seriesId);

        const api = new DisneyApi(this.options);
        const resume = await api.pickEpisodeForSeries(seriesId);
        if (!resume) {
            debug("no episode to resume; start from the beginning?");
            return;
        }

        const { episode, startTime } = resume;

        debug("... resume:", episode, " at ", startTime);

        if (opts.resume === false) {
            return this.playById(episode.contentId);
        }

        await this.playById(episode.contentId, {
            startTime,
        });
    }

    public async playByFamilyId(
        familyId: string,
        opts: IPlayableOptions = {},
    ) {
        const api = new DisneyApi(this.options);
        const {
            contentId,
            startTime,
        } = await api.getResumeForFamilyId(familyId);

        if (opts.resume === false) {
            return this.playById(contentId);
        }

        return this.playById(contentId, {
            startTime,
        });
    }

    private async loadCredentials() {
        const api = new DisneyApi(this.options);
        const tokens = await api.ensureTokensValid();

        return {
            accessState: JSON.stringify({
                data: {
                    contextState: {
                        modes: [ "bamIdentity" ],
                    },
                    refreshToken: tokens.refreshToken,
                    token: tokens.token,
                },
                version: "4.9",
            }),
        };
    }

}
