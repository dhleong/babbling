import _debug from "debug";

import { ChromecastDevice } from "stratocaster";

import { BaseApp, MEDIA_NS } from "../base";
import { ILoadRequest } from "../../cast";

import { HboApi } from "./api";
import { HboPlayerChannel } from "./channel";
import { HboConfigurable, IHboOpts } from "./config";

const debug = _debug("babbling:hbo");
export { IHboOpts } from "./config";

const APP_ID = "DD4BFB02";

export interface IHboPlayOptions {
    /** Eg "en-US" */
    locale?: string;
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
            deviceSerialNumber: senderDeviceSerialNumber,
        } = await this.api.extractTokenInfo();

        const [refreshToken, s] = await Promise.all([
            this.api.getRefreshToken(),
            this.ensureCastSession(),

            // stop other concurrent streams? (the web app does it)
            this.api.stopConcurrentStreams(),
        ]);

        debug("Joined media session", s.destination);
        const locale = options.locale ?? "en-US";

        const req: ILoadRequest = {
            autoplay: true,
            currentTime: options.startTime,
            customData: {
                authToken: {
                    refresh_token: refreshToken,
                },

                isPreview: false, // ?
                headwaiterOverrides: undefined,
                preferredAudioTrack: undefined,
                preferredEditLanguage: locale,
                preferredTextTrack: options.showSubtitles ? locale : undefined,
                senderDeviceSerialNumber,
                senderDeviceLocale: options.locale ?? "en-US",
                senderDevicePrivacySettings: {
                    allowFunctionalCookies: true,
                    allowPerformanceCookies: false,
                    allowTaretingCookies: false,
                    disableDataSharing: true,
                },

                // senderSessionId: "", // what should go here?
            },
            media: {
                contentId: urn,
                contentType: "application/dash+xml",
                streamType: "BUFFERED",
            },
            sessionId: s.destination ?? "",
            type: "LOAD",
        };

        const ms = await s.send(req as any);
        debug(ms);

        if (ms.type !== "MEDIA_STATUS") {
            debug("LOAD request=", req);

            const message = (ms as any).customData?.exception?.message ?? JSON.stringify(ms);
            throw new Error(`Load of ${urn} failed: ${message}`);
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
