import _debug from "debug";
const debug = _debug("babbling:PrimeApp:player");

import { ContentType } from "chakram-ts";

import { IPlayableOptions, IPlayerChannel, IQueryResult } from "../../app";
import { PrimeApi } from "./api";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import { IPrimeOpts, PrimeApp } from ".";
import { AvailabilityType, IAvailability, ISearchResult } from "./model";

export class PrimePlayerChannel implements IPlayerChannel<PrimeApp> {

    constructor(
        private readonly options: IPrimeOpts,
    ) {}

    public ownsUrl(url: string): boolean {
        // TODO other domains
        return url.includes("amazon.com");
    }

    public async createPlayable(url: string) {
        const titleId = pickTitleIdFromUrl(url);
        if (!titleId) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const api = new PrimeApi(this.options);
        const titleIdInfo = await api.getTitleInfo(titleId);
        debug("titleInfo for ", titleId, " = ", titleIdInfo);

        if (titleIdInfo.series) {
            return playableFromTitleId(titleIdInfo.series.titleId);
        } else if (titleIdInfo.movie) {
            return playableForMovieById(titleIdInfo.movie.titleId);
        }

        // *probably* a movie
        return playableForMovieById(titleId);
    }

    public async *queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult & { titleId: string }> {
        const api = new PrimeApi(this.options);
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

    const m3 = url.match(/dp\/([^\/\?]+)/);
    if (m3) {
        return m3[1];
    }
}

function playableFromSearchResult(result: ISearchResult) {
    if (result.type === ContentType.MOVIE) {
        // we can use MOVIE results directly
        return playableForMovieById(result.titleId || result.id);
    }

    return playableFromTitleId(result.titleId);
}

function playableFromTitleId(titleId: string) {
    return async (app: PrimeApp, opts: IPlayableOptions) =>
        app.resumeSeriesByTitleId(titleId);
}

function playableForMovieById(id: string) {
    return async (app: PrimeApp, opts: IPlayableOptions) => {
        if (opts.resume === false) {
            await app.play(id, { startTime: 0 });
        } else {
            await app.play(id, {});
        }
    };
}
