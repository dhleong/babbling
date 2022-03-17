import debug_ from "debug";

// tslint:disable max-classes-per-file

import {
    ChakramApi, ContentType, IBaseObj, IEpisode, ISeason,
} from "chakram-ts";
import { ChromecastDevice } from "stratocaster";

import { IPlayableOptions, IPlayerChannel, IQueryResult } from "../app";
import { CookiesConfigurable } from "../cli/configurables";
import { BabblerBaseApp, IPlayableInfo, IQueueItem } from "./babbler/base";
import { SenderCapabilities } from "./babbler/model";

const debug = debug_("babbling:prime");

export interface IBabblerPrimeOpts {
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

function toQueueItem(item: IBaseObj): IQueueItem<IBaseObj> {
    const { title } = item;
    let images: string[] | undefined;
    let seriesTitle: string | undefined;

    if (item.cover) {
        images = [item.cover];
    }

    const episode = item as IEpisode;
    if (episode.series) {
        seriesTitle = episode.series.title;

        if (!images && episode.series.cover) {
            images = [episode.series.cover];
        }
    }

    return {
        id: item.id,
        media: item,
        metadata: {
            images,
            seriesTitle,
            title,
        },
    };
}

/** Number of items to return for QUEUE requests */
const QUEUE_SIZE = 5;

function cleanTitle(original: string) {
    // including this suffix confuses title-matching
    return original.replace("(4K UHD)", "").trim();
}

class BabblerPrimeChannel implements IPlayerChannel<BabblerPrimeApp> {
    constructor(
        private readonly options: IBabblerPrimeOpts,
    ) {}

    public ownsUrl(url: string): boolean {
        // TODO other domains
        return url.includes("amazon.com");
    }

    public async createPlayable(
        url: string,
    ) {
        const m = url.match(/video\/detail\/([^\/]+)/);
        if (!m) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const api = new ChakramApi(this.options.cookies);
        const titleId = m[1];
        const info = await api.getTitleInfo(titleId);

        return this.playableFromObj(info);
    }

    public async* queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        const api = new ChakramApi(this.options.cookies);
        for (const result of await api.search(title)) {
            yield {
                appName: "PrimeApp",
                playable: this.playableFromObj(result),
                title: cleanTitle(result.title),
                url: `https://www.amazon.com/video/detail/${result.id}`,
            };
        }
    }

    private playableFromObj(info: IBaseObj) {
        if (info.type === ContentType.SERIES) {
            debug("playable for series", info.id);
            return async (app: BabblerPrimeApp) => app.resumeSeries(info.id);
        } if (info.type === ContentType.SEASON) {
            // probably they want to resume the series
            const season = info as ISeason;
            if (season.series) {
                const seriesId = season.series.id;
                debug("playable for series given season", seriesId);
                return async (app: BabblerPrimeApp) => app.resumeSeries(
                    seriesId,
                );
            }
        }

        debug("playable for title", info.id);
        return async (app: BabblerPrimeApp, opts: IPlayableOptions) => {
            if (opts.resume === false) {
                await app.playTitle(info.id, { startTime: 0 });
            } else {
                await app.playTitle(info.id);
            }
        };
    }
}

/**
 * Amazon Prime Video
 */
export class BabblerPrimeApp extends BabblerBaseApp {
    public static configurable = new CookiesConfigurable<IBabblerPrimeOpts>("https://www.amazon.com");

    public static createPlayerChannel(options: IBabblerPrimeOpts) {
        return new BabblerPrimeChannel(options);
    }

    private api: ChakramApi;

    constructor(
        device: ChromecastDevice,
        opts: IBabblerPrimeOpts,
    ) {
        super(device, {
            appId: opts.appId,

            // tslint:disable no-bitwise
            capabilities: SenderCapabilities.DeferredInfo
                | SenderCapabilities.QueueNext
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

        let { startTime } = opts;
        if (startTime === undefined) {
            try {
                const resume = await this.api.guessResumeInfo(info.id);
                startTime = resume.startTimeSeconds;
            } catch (e) {
                // best effort; no resume info found, so ignore
            }
        }

        debug("load", info, "at", startTime);
        return this.loadMedia({ currentTime: startTime, ...toQueueItem(info) });
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        if (!url) throw new Error("No license url provided");
        return this.api.fetchLicense(url, buffer);
    }

    protected async loadInfoFor(
        contentId: string,
    ): Promise<IPlayableInfo> {
        debug(`load playableInfo for ${contentId}`);

        const {
            manifests,
            licenseUrl,
        } = await this.api.getPlaybackInfo(contentId);

        // pick *some* manifest
        shuffle(manifests);

        const chosenUrl = manifests[0].url;
        debug(
            `got playback info for ${contentId}; loading manifest @`,
            chosenUrl,
        );

        return {
            contentId,
            contentUrl: chosenUrl,
            customData: {
                license: {
                    ipc: true,
                    url: licenseUrl,
                },
            },
        };
    }

    protected async loadQueueAfter(
        contentId: string,
        media?: IBaseObj,
    ): Promise<Array<IQueueItem<IBaseObj>>> {
        return this.loadQueueRelative(
            "after",
            contentId,
            media,
            (episodes, index) => episodes.slice(
                index + 1,
                Math.min(index + 1 + QUEUE_SIZE, episodes.length - 1),
            ),
        );
    }

    protected async loadQueueBefore(
        contentId: string,
        media?: IBaseObj,
    ): Promise<Array<IQueueItem<IBaseObj>>> {
        return this.loadQueueRelative(
            "before",
            contentId,
            media,
            (episodes, index) => episodes.slice(
                Math.max(0, index - 1 - QUEUE_SIZE),
                Math.max(0, index - 1),
            ),
        );
    }

    protected async loadQueueRelative(
        mode: string,
        contentId: string,
        media: IBaseObj | undefined,
        sliceEpisodes: (
            episodes: IEpisode[],
            currentIndex: number,
        ) => IEpisode[],
    ): Promise<Array<IQueueItem<IBaseObj>>> {
        // TODO we could fetch it, since we have the contentId
        if (!media) return [];

        if (media.type !== ContentType.EPISODE) {
            debug(`cannot load queue for ${media.type} media`);
            return [];
        }

        const episode = media as IEpisode;
        if (!episode.series) {
            // TODO we could fetch it...?
            debug(`series for ${contentId} unknown`);
            return [];
        }

        debug(`queue ${mode} for`, contentId, media);

        const episodes = await this.api.getEpisodes(episode.series.id);
        const index = episodes.findIndex(ep => ep.id === contentId);
        if (index === -1) {
            debug(`couldn't find ${contentId} in episodes of ${episode.series.id}`);
            return [];
        }

        const queue = sliceEpisodes(episodes, index);
        return queue.map(toQueueItem);
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
