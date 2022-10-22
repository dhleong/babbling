import _debug from "debug";

import { ChromecastDevice, MEDIA_NS } from "stratocaster";

import { BaseApp } from "../base";
import { ILoadRequest } from "../../cast";

import { HboApi } from "./api";
import { HboPlayerChannel } from "./channel";
import { HboConfigurable, IHboOpts } from "./config";

const debug = _debug("babbling:hbo");
export { IHboOpts } from "./config";

const APP_ID = "DD4BFB02";
const HBO_NS = "urn:x-cast:hbogo";

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
            sessionNs: HBO_NS,
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

        const [refreshToken, s, mediaSession] = await Promise.all([
            this.api.getRefreshToken(),
            this.ensureCastSession(),
            this.joinOrRunNamespace(MEDIA_NS),

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
                senderDeviceLocale: locale?.toLowerCase(),
                senderDevicePrivacySettings: {
                    allowFunctionalCookies: true,
                    allowPerformanceCookies: false,
                    allowTargetingCookies: false,
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

        // NOTE: HBO has done something quite silly here and made their own
        // custom message handler in a separate ns and not responding to the
        // request properly in that ns, so instead we have to listen for the response
        // in the media NS
        await s.write({
            loadRequestData: req,
            type: "LOAD_MEDIA",
        });

        debug("Awaiting PLAYING media status");
        for await (const m of mediaSession.receive()) {
            if (typeof m.data !== "object" || Buffer.isBuffer(m.data)) continue;
            if (m.data.type !== "MEDIA_STATUS" || !Array.isArray(m.data.status) || m.data.status.length === 0) {
                continue;
            }

            const status = m.data.status[0];
            debug("Received:", status);

            if (status.media?.contentId !== urn && status.media?.entity !== urn && status.playerState === "IDLE") {
                throw new Error(`Failed to play ${urn}`);
            }

            if (status.media?.contentId !== "" && status.media?.contentId !== urn) {
                // Something else must be playing
                debug("Got MEDIA_STATUS for", status.media);
                return;
            }

            if (status.playerState === "PLAYING") {
                debug("Playing!");
                return;
            }
        }
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
