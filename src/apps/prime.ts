import debug_ from "debug";
const debug = debug_("babbling:prime");

import { ChakramApi, ContentType, IBaseObj, IEpisode, ISeason } from "chakram-ts";
import { IDevice } from "nodecastor";

import { IPlayableOptions, IQueryResult } from "../app";
import { CookiesConfigurable } from "../cli/configurables";
import { BabblerBaseApp } from "./babbler/base";
import { SenderCapabilities } from "./babbler/model";

export interface IPrimeOpts {
    appId: string;
    cookies: string;
}

/** fisher-yates shuffle */
function shuffle(a: any[]) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
}

/**
 * Amazon Prime Video
 */
export class PrimeApp extends BabblerBaseApp {

    public static configurable = new CookiesConfigurable<IPrimeOpts>("https://www.amazon.com");

    public static ownsUrl(url: string) {
        // TODO other domains
        return url.includes("amazon.com");
    }

    public static async createPlayable(
        url: string,
        options: IPrimeOpts,
    ) {
        const m = url.match(/video\/detail\/([^\/]+)/);
        if (!m) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const api = new ChakramApi(options.cookies);
        const titleId = m[1];
        const info = await api.getTitleInfo(titleId);

        return PrimeApp.playableFromObj(info);
    }

    public static async *queryByTitle(
        title: string,
        opts: IPrimeOpts,
    ): AsyncIterable<IQueryResult> {
        const api = new ChakramApi(opts.cookies);
        for (const result of await api.search(title)) {
            yield {
                appName: "PrimeApp",
                playable: PrimeApp.playableFromObj(result),
                title: result.title,
                url: "https://www.amazon.com/video/detail/" + result.id,
            };
        }
    }

    private static playableFromObj(info: IBaseObj) {
        if (info.type === ContentType.SERIES) {
            debug("playable for series", info.id);
            return async (app: PrimeApp) => app.resumeSeries(info.id);
        } else if (info.type === ContentType.SEASON) {
            // probably they want to resume the series
            const season = info as ISeason;
            if (season.series) {
                const seriesId = season.series.id;
                debug("playable for series given season", seriesId);
                return async (app: PrimeApp) => app.resumeSeries(
                    seriesId,
                );
            }
        }

        debug("playable for title", info.id);
        return async (app: PrimeApp, opts: IPlayableOptions) => {
            if (opts.resume === false) {
                await app.playTitle(info.id, { startTime: 0 });
            } else {
                await app.playTitle(info.id);
            }
        };
    }

    private api: ChakramApi;

    constructor(
        device: IDevice,
        opts: IPrimeOpts,
    ) {
        super(device, {
            appId: opts.appId,

            // tslint:disable no-bitwise
            capabilities: SenderCapabilities.QueueNext
                | SenderCapabilities.QueuePrev,
            // tslint:enable no-bitwise

            daemonOptions: opts,
            useLicenseIpc: true,
        });

        this.api = new ChakramApi(opts.cookies);
    }

    /**
     * Attempt to resume playback of the series with the
     * given ID
     */
    public async resumeSeries(
        id: string,
    ) {
        const toResume = await this.api.guessResumeInfo(id);

        await this.playTitle(toResume.id, {
            startTime: toResume.startTimeSeconds,
        });
    }

    /**
     * Options:
     * - id: ID of a title to play
     * - startTime: Time in seconds to start playback. If unspecified,
     *   we attempt to resume where you left off
     */
    public async playTitle(
        id: string,
        opts: {
            startTime?: number,
        } = {},
    ) {
        // resolve the ID first; amazon's ID usage is... odd.
        // plus, it gives us the chance to fetch metadata
        const info = await this.api.getTitleInfo(id);
        if (!info) {
            throw new Error(`Unable to resolve title with id ${id}`);
        }
        debug("play title", info);

        if (info.type === ContentType.SERIES) {
            throw new Error(`${id} is a series; use resumeSeries instead`);
        } else if (info.type === ContentType.SEASON) {
            throw new Error(`${id} is a season`);
        }

        const {
            manifests,
            licenseUrl,
        } = await this.api.getPlaybackInfo(info.id);

        // pick *some* manifest
        shuffle(manifests);

        let title = info.title;
        let images: string[] | undefined;

        if (info.cover) {
            images = [info.cover];
        }

        const episode = info as IEpisode;
        if (episode.series) {
            title = `${episode.series.title} - ${title}`;

            if (!images && episode.series.cover) {
                images = [episode.series.cover];
            }
        }

        let startTime = opts.startTime;
        if (startTime === undefined) {
            try {
                const resume = await this.api.guessResumeInfo(info.id);
                startTime = resume.startTimeSeconds;
            } catch (e) {
                // best effort; no resume info found, so ignore
            }
        }

        const chosenUrl =  manifests[0].url;
        debug(
            "got playback info; loading manifest @",
            chosenUrl,
            "; starting at", startTime,
        );
        return this.loadUrl(chosenUrl, {
            licenseUrl,
            media: info,
            metadata: {
                images,
                title,
            },
            startTime,
        });
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        if (!url) throw new Error("No license url provided");
        return this.api.fetchLicense(url, buffer);
    }

    protected async performQueueRequest(
        mode: string,
        contentId: string,
    ) {
        debug("TODO: queue", mode, contentId);
        // TODO
        return [];
    }

    protected async onPlayerPaused(
        currentTimeSeconds: number,
        media?: IBaseObj,
    ) {
        if (!media) {
            debug("no media; cannot submit time", currentTimeSeconds);
            return;
        }

        debug("save watch time", currentTimeSeconds, media);
        await this.api.saveWatchTime(media.id, currentTimeSeconds);
    }
}
