import _debug from "debug";
const debug = _debug("babbling:PrimeApp");

import { ChakramApi } from "chakram-ts";
import { ILoadRequest, IMedia } from "nodecastor";
import { ChromecastDevice, StratoChannel } from "stratocaster";

import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";

import { PrimeApi, IEpisode } from "./api";
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

    constructor(device: ChromecastDevice, options: IPrimeOpts) {
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
        { queue, startTime }: {
            queue?: string[],
            startTime?: number,
        },
    ) {
        debug("play: join", AUTH_NS);
        const session = await this.joinOrRunNamespace(AUTH_NS);
        const resp = await castRequest(session,
            this.message("AmIRegistered"),
        );
        debug("registered=", resp);

        if (resp.error && resp.error.code === "NotRegistered") {
            await this.register(session);
        }

        debug("registered! ensureCastSession... ");
        const s = await this.ensureCastSession();

        debug("request playback:", titleId);
        const request: ILoadRequest = {
            autoplay: true,
            customData: {
                deviceId: this.api.deviceId,
                initialTracks: {},
            },
            media: titleIdToCastMedia(titleId),
            sessionId: s.destination!!,
            type: "LOAD",
        };

        if (startTime !== undefined) {
            request.currentTime = startTime;
        }

        if (queue && queue.length) {
            installQueue(request, queue, titleId);
        }

        // send LOAD request!
        const ms = await s.send(request as any);
        if (ms.type !== "MEDIA_STATUS") {
            throw new Error(`Load failed: ${JSON.stringify(ms)}`);
        }

        debug((ms as any).status[0].media);
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
                queue: toResume.queue,
                startTime: toResume.watchedSeconds,
            });
        }

        try {
            const info = await this.api.getTitleInfo(titleId);
            debug("no resume info found; play:", titleId);
            debug(" -> info=", info);

            if (info.selectedEpisode && info.selectedEpisode.isSelected) {
                debug(" -> play selectedEpisode", info.selectedEpisode);
                return this.playEpisode(info.selectedEpisode);
            }

            if (info.episodes && info.episodes.length) {
                debug(" -> play the first episode:", info.episodes[0]);
                return this.playEpisode(info.episodes[0]);
            }
        } catch (e) {
            debug("unable to resolve title info", e);
        }

        debug("no resume info found; play:", titleId);
        return this.play(titleId, {});
    }

    private async playEpisode(episode: IEpisode) {
        const { completedAfter, watchedSeconds } = episode;
        if (watchedSeconds >= completedAfter) {
            debug(`watched=${watchedSeconds} > ${completedAfter}; restart`);
            return this.play(episode.titleId, {});
        }

        debug(`resume ${episode.titleId} @${watchedSeconds}`);
        return this.play(episode.titleId, {
            startTime: watchedSeconds,
        });
    }

    private message(type: string, extra: any = {}) {
        return Object.assign({
            deviceId: this.api.deviceId,
            messageProtocolVersion: 1,
            type,
        }, extra);
    }

    private async register(session: StratoChannel) {
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

    private async applySettings(session: StratoChannel) {
        await checkedRequest(session, this.message("ApplySettings", {
            settings: {
                autoplayNextEpisode: true,
                locale: this.api.getLanguage(),
            },
        }));
    }

}

async function castRequest(session: StratoChannel, message: any) {
    // it's infuriatingly dumb that amazon built their own protocol
    // on top of the protocol instead of just using the requestId
    // like a normal human.
    const responseType = message.type + "Response";
    await session.write(message);
    debug("wait for ", responseType, "...");
    return awaitMessageOfType(session, responseType, 15_000);
}

async function checkedRequest(session: StratoChannel, message: any) {
    const resp = await castRequest(session, message);
    if (resp.error) {
        throw resp.error;
    }
    debug(" -> ", resp);
    return resp;
}

function titleIdToCastMedia(titleId: string): IMedia {
    return {
        customData: {
            videoMaterialType: "Feature", // TODO ?
        },

        contentId: titleId,
        contentType: "video/mp4",
        streamType: "BUFFERED",
    };
}

function installQueue(
    request: ILoadRequest,
    queue: string[],
    initialTitleId: string,
) {
    let startIndex = queue.indexOf(initialTitleId);
    const items = queue.map(id => ({
        customData: request.customData,
        media: titleIdToCastMedia(id),
    }));

    if (startIndex === -1) {
        // the queue contained only upcoming items
        startIndex = 0;
        items.unshift({
            customData: request.customData,
            media: request.media,
        });
    }

    request.queueData = {
        items,
        startIndex,
    };
}
