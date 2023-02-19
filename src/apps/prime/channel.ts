import _debug from "debug";

import { ContentType } from "chakram-ts";

import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
    IRecommendationQuery,
    RecommendationType,
} from "../../app";
import { EpisodeResolver } from "../../util/episode-resolver";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import type { IPrimeOpts, PrimeApp } from ".";

import { PrimeApi } from "./api";
import { PrimeEpisodeCapabilities } from "./api/episode-capabilities";
import { AvailabilityType, IAvailability, ISearchResult } from "./model";
import withRecommendationType from "../../util/withRecommendationType";
import filterRecommendations from "../../util/filterRecommendations";
import { PrimeEpisodeListings } from "./episodes";
import {
    pickTitleIdFromUrl,
    playableForMovieById,
    playableFromTitleId,
    playableFromTitleInfo,
    urlFor,
} from "./playable";

const debug = _debug("babbling:PrimeApp:player");

function isAvailableOnlyWithAds(availability: IAvailability[]) {
    const canPlayWithAds =
        availability.findIndex(
            (a) => a.type === AvailabilityType.FREE_WITH_ADS,
        ) !== -1;
    if (!canPlayWithAds) return false;

    // we can play with ads, so it's *only* available with ads iff we don't find
    // another availability type
    return (
        availability.findIndex(
            (a) =>
                a.type === AvailabilityType.PRIME ||
                a.type === AvailabilityType.OTHER_SUBSCRIPTION ||
                a.type === AvailabilityType.OWNED,
        ) === -1
    );
}

function playableFromSearchResult(result: ISearchResult) {
    if (result.type === ContentType.MOVIE) {
        // we can use MOVIE results directly
        return playableForMovieById(result.titleId || result.id);
    }

    return playableFromTitleId(result.titleId);
}

export class PrimePlayerChannel implements IPlayerChannel<PrimeApp> {
    constructor(private readonly options: IPrimeOpts) {}

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

        return (
            playableFromTitleInfo(titleIdInfo) ?? playableForMovieById(titleId)
        );
    }

    public async createEpisodeListingsFor(item: IQueryResult) {
        if (item.appName !== "PrimeApp") {
            throw new Error(`Received unexpected appName: ${item.appName}`);
        }
        if (item.url == null) {
            throw new Error(`Missing url for query result: ${item.title}`);
        }

        const titleId = pickTitleIdFromUrl(item.url);
        if (!titleId) {
            throw new Error(`Unsure how to play ${item.url}`);
        }

        const api = new PrimeApi(this.options);
        const titleIdInfo = await api.getTitleInfo(titleId);
        debug("titleInfo for ", titleId, " = ", titleIdInfo);

        if (titleIdInfo.series == null) {
            // Not a series
            return;
        }

        return new PrimeEpisodeListings(api, titleIdInfo);
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        if (item.appName !== "PrimeApp") {
            throw new Error("Given QueryResult for wrong app");
        }
        if (item.url == null) {
            throw new Error(`Missing url for query result: ${item.title}`);
        }

        const titleId = pickTitleIdFromUrl(item.url);
        if (titleId == null) {
            throw new Error(`Unexpected url for query result: ${item.url}`);
        }

        const api = new PrimeApi(this.options);
        const titleIdInfo = await api.getTitleInfo(titleId);
        debug("titleInfo for ", item.url, " = ", titleIdInfo);

        if (titleIdInfo.series == null) {
            // shortcut out; it definitely does not have episodes
            return;
        }

        const episodes = new EpisodeResolver(
            new PrimeEpisodeCapabilities(api, titleId),
        );
        const found = await episodes.query(query);
        if (!found) return;

        return {
            appName: "PrimeApp",
            cover: item.cover,
            hasAds: item.hasAds,
            isPreferred: item.isPreferred,
            seriesTitle: item.title,
            title: found.title,

            async playable(app: PrimeApp) {
                return app.play(found.titleId, {});
            },
        };
    }

    public async *queryByTitle(title: string): AsyncIterable<IQueryResult> {
        const api = new PrimeApi(this.options);
        for await (const result of api.search(title)) {
            yield {
                appName: "PrimeApp",
                cover: result.cover,
                desc: result.desc,
                hasAds: isAvailableOnlyWithAds(result.availability),
                isPreferred: result.isInWatchlist || result.isPurchased,
                playable: playableFromSearchResult(result),
                title: result.title,
                url: urlFor(result),
            };
        }
    }

    public async *queryRecent(): AsyncIterable<IQueryResult> {
        const api = new PrimeApi(this.options);
        for await (const result of api.nextUpItems()) {
            yield {
                appName: "PrimeApp",
                cover: result.cover,
                desc: result.desc,
                playable: playableFromTitleId(result.titleId),
                title: result.title,
                url: urlFor(result),
            };
        }
    }

    public async *queryRecommended(): AsyncIterable<IQueryResult> {
        // NOTE: Legacy behavior:
        yield* this.queryRecent();
    }

    public async *queryRecommendations(query?: IRecommendationQuery) {
        yield* filterRecommendations(
            query,
            withRecommendationType(
                RecommendationType.Recent,
                this.queryRecent(),
            ),
        );
    }
}
