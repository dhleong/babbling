import _debug from "debug";
const debug = _debug("babbling:PrimeApp");

import { ChakramApi, ContentType, IBaseObj, ISeason } from "chakram-ts";

import { IPlayableOptions, IQueryResult } from "../../app";
import { ICastSession, IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";
import { PrimeApi } from "./api";
import { IPrimeOpts } from "./config";

export { IPrimeOpts } from "./config";

const APP_ID = "17608BC8";
const AUTH_NS = "urn:x-cast:com.amazon.primevideo.cast";

// USA marketplace ID
const DEFAULT_MARKETPLACE_ID = "ATVPDKIKX0DER";

export class PrimeApp extends BaseApp {

    public static ownsUrl(url: string) {
        // TODO other domains
        return url.includes("amazon.com");
    }

    public static async createPlayable(
        url: string,
        options: IPrimeOpts,
    ) {
        const titleId = pickTitleIdFromUrl(url);
        if (!titleId) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const api = new ChakramApi(options.cookies);
        const info = await api.getTitleInfo(titleId);
        debug("titleInfo = ", info);

        return playableFromObj(info);
    }

    public static async *queryByTitle(
        title: string,
        opts: IPrimeOpts,
    ): AsyncIterable<IQueryResult> {
        const api = new ChakramApi(opts.cookies);
        for (const result of await api.search(title)) {
            yield {
                appName: "PrimeApp",
                playable: playableFromObj(result),
                title: cleanTitle(result.title),
                url: "https://www.amazon.com/video/detail/" + result.id,
            };
        }
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
            request.startTime = startTime;
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

function playableFromObj(info: IBaseObj) {
    if (info.type === ContentType.SERIES) {
        debug("playable for series", info.id);
        return async (app: PrimeApp) => app.resumeSeries(info.id);
    } else if (info.type === ContentType.SEASON) {
        // probably they want to resume the series
        const season = info as ISeason;
        if (season.series) {
            const seriesId = season.series.id;
            debug("playable for series", seriesId, "given season", seriesId);
            return async (app: PrimeApp) => app.resumeSeries(seriesId);
        }
    }

    debug("playable for title", info.id);
    return async (app: PrimeApp, opts: IPlayableOptions) => {
        if (opts.resume === false) {
            await app.play(info.id, { startTime: 0 });
        } else {
            await app.play(info.id, {});
        }
    };
}

function pickTitleIdFromUrl(url: string) {
    const m1 = url.match(/video\/detail\/([^\/]+)/);
    if (m1) {
        return m1[1];
    }

    const m2 = url.match(/gp\/product\/([^\/\?]+)/);
    if (m2) {
        return m2[1];
    }
}

function cleanTitle(original: string) {
    // including this suffix confuses title-matching
    return original.replace("(4K UHD)", "").trim();
}
