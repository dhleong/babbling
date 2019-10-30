import _debug from "debug";
const debug = _debug("babbling:PrimeApp:player");

import { ChakramApi, ContentType, IBaseObj, IEpisode, ISeason } from "chakram-ts";

import { IPlayableOptions, IPlayerChannel, IQueryResult } from "../../app";
import { PrimeApi } from "./api";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import { IPrimeOpts, PrimeApp } from ".";
import { AvailabilityType, IAvailability, ISearchResult } from "./model";

export class PrimePlayerChannel implements IPlayerChannel<PrimeApp> {

    public ownsUrl(url: string): boolean {
        // TODO other domains
        return url.includes("amazon.com");
    }

    public async createPlayable(url: string, options: IPrimeOpts) {
        const titleId = pickTitleIdFromUrl(url);
        if (!titleId) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const api = new ChakramApi(options.cookies);
        const info = await api.getTitleInfo(titleId);
        debug("titleInfo = ", info);

        return playableFromObj(info);
    }

    public async *queryByTitle(
        title: string,
        opts: IPrimeOpts,
    ): AsyncIterable<IQueryResult & { titleId: string }> {
        const api = new PrimeApi(opts);
        for await (const result of api.search(title)) {
            yield {
                appName: "PrimeApp",
                desc: result.desc,
                hasAds: isAvailableOnlyWithAds(result.availability),
                isPreferred: result.isInWatchlist || result.isPurchased,
                playable: playableFromSearchResult(result),
                title: result.title,
                titleId: result.titleId,
                url: "https://www.amazon.com/gp/video/detail/" + result.id,
            };
        }
    }

}

function isAvailableOnlyWithAds(availability: IAvailability[]) {
    const canPlayWithAds = -1 !== availability.findIndex(a =>
        a.type === AvailabilityType.FREE_WITH_ADS);
    if (!canPlayWithAds) return false;

    // we can play with ads, so it's *only* available with ads iff we don't find
    // another availability type
    return -1 === availability.findIndex(a =>
        a.type === AvailabilityType.PRIME
            || a.type === AvailabilityType.OTHER_SUBSCRIPTION
            || a.type === AvailabilityType.OWNED);
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

function playableFromObj(info: IBaseObj) {
    if (info.type === ContentType.EPISODE) {
        const { series } = info as IEpisode;
        if (series) {
            debug("playable for series", series.id, "from episode", info.id);
            return async (app: PrimeApp) => app.resumeSeries(series.id);
        }
    } else if (info.type === ContentType.SERIES) {
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

function playableFromSearchResult(result: ISearchResult) {
    if (result.type === ContentType.MOVIE) {
        // we can use MOVIE results directly
        return playableFromObj(result);
    }

    if (result.titleId) {
        return async (app: PrimeApp, opts: IPlayableOptions) =>
            app.resumeSeriesByTitleId(result.titleId);
    }

    // we have to resolve the series, first, because the ID we have resolves
    // to the first episode of the series, which is unhelpful; resolving the
    // title lets us delegate to the old obj->playable logic above that we
    // can then use to properly resume series
    return async (app: PrimeApp, opts: IPlayableOptions) => {
        const chakram = (app as any).chakram as ChakramApi;
        const title = await chakram.getTitleInfo(result.id);
        debug("resolved", result, "to", title);

        const resolved = playableFromObj(title);
        return resolved(app, opts);
    };
}
