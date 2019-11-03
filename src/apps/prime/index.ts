import _debug from "debug";
const debug = _debug("babbling:PrimeApp");

import { ChakramApi } from "chakram-ts";

import { ICastSession, IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";

import { PrimeApi } from "./api";
import { PrimePlayerChannel } from "./channel";
import { IPrimeOpts } from "./config";

export { IPrimeOpts } from "./config";

const APP_ID = "17608BC8";
const AUTH_NS = "urn:x-cast:com.amazon.primevideo.cast";

// USA marketplace ID
const DEFAULT_MARKETPLACE_ID = "ATVPDKIKX0DER";

export class PrimeApp extends BaseApp {

    // declare Player support
    public static createPlayerChannel(options: IPrimeOpts) {
        return new PrimePlayerChannel(options);
    }

    private readonly api: PrimeApi;
    private readonly chakram: ChakramApi;
    private readonly refreshToken: string;
    private readonly marketplaceId: string;

    constructor(device: IDevice, options: IPrimeOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.refreshToken = options.refreshToken;
        this.api = new PrimeApi(options);
        this.chakram = new ChakramApi(options.cookies);

        // TODO derive this somehow?
        this.marketplaceId = options.marketplaceId || DEFAULT_MARKETPLACE_ID;
    }

    public async play(
        titleId: string,
        { startTime }: {
            startTime?: number,
        },
    ) {
        debug("play: join", AUTH_NS);
        const session = await this.joinOrRunNamespace(AUTH_NS);
        const resp = await castRequest(session, this.message("AmIRegistered"));
        debug("registered=", resp);

        if (resp.error && resp.error.code === "NotRegistered") {
            await this.register(session);
        }

        debug("registered! ensureCastSession... ");
        const s = await this.ensureCastSession();

        debug("request playback:", titleId);
        const request: any = {
            autoplay: true,
            customData: {
                deviceId: this.api.deviceId,
                initialTracks: {},
            },
            media: {
                customData: {
                    videoMaterialType: "Feature", // TODO ?
                },

                contentId: titleId,
                contentType: "video/mp4",
                streamType: "BUFFERED",
            },
            sessionId: s.id,
            type: "LOAD",
        };

        if (startTime !== undefined) {
            request.currentTime = startTime;
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
        debug(ms.status[0].media);
    }

    /**
     * Attempt to resume playback of the series with the given ID
     */
    public async resumeSeries(
        id: string,
    ) {
        const toResume = await this.chakram.guessResumeInfo(id);

        await this.play(toResume.id, {
            startTime: toResume.startTimeSeconds,
        });
    }

    /**
     * Attempt to resume playback of the series with the given ID
     */
    public async resumeSeriesByTitleId(
        titleId: string,
    ) {
        const toResume = await this.api.guessResumeInfo(titleId);
        if (toResume) {
            debug("resume: ", toResume);
            return this.play(toResume.titleId, {
                startTime: toResume.watchedSeconds,
            });
        }

        debug("no resume info found; play:", titleId);
        return this.play(titleId, {});
    }

    private message(type: string, extra: any = {}) {
        return Object.assign({
            deviceId: this.api.deviceId,
            messageProtocolVersion: 1,
            type,
        }, extra);
    }

    private async register(session: ICastSession) {
        debug("register with id", this.api.deviceId);

        const preAuthorizedLinkCode =
            await this.api.generatePreAuthorizedLinkCode(this.refreshToken);

        await checkedRequest(session, this.message("Register", {
            marketplaceId: this.marketplaceId,

            preAuthorizedLinkCode,
        }));

        debug("applying settings");
        await this.applySettings(session);
    }

    private async applySettings(session: ICastSession) {
        await checkedRequest(session, this.message("ApplySettings", {
            settings: {
                autoplayNextEpisode: true,
                locale: this.api.getLanguage(),
            },
        }));
    }

}

async function castRequest(session: ICastSession, message: any) {
    const responseType = message.type + "Response";
    session.send(message);
    return awaitMessageOfType(session, responseType, 15_000);
}

async function checkedRequest(session: ICastSession, message: any) {
    const resp = await castRequest(session, message);
    if (resp.error) {
        throw resp.error;
    }
    debug(" -> ", resp);
    return resp;
}
