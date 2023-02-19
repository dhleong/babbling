import _debug from "debug";

import {
    IEpisodeListings,
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayableOptions,
    IPlayerChannel,
    IQueryResult,
    IRecommendationQuery,
    RecommendationType,
} from "../../app";
import { mergeAsyncIterables } from "../../async";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import type { DisneyApp, IDisneyOpts } from ".";
import { DisneyApi, ICollection, ISearchHit, pickPreferredImage } from "./api";
import filterRecommendations from "../../util/filterRecommendations";
import { DisneyEpisodeListings } from "./episodes";

const debug = _debug("babbling:DisneyApp:channel");

const PLAYBACK_URL = "https://www.disneyplus.com/video/";
const SERIES_URL = "https://www.disneyplus.com/series/";
const MOVIE_URL = "https://www.disneyplus.com/movies/";

const RECOMMENDATION_SET_TYPES = new Set([
    "RecommendationSet",
    "CuratedSet",
    "ContinueWatchingSet",
] as const);

export type CollectionSetType = ICollection["type"];

function getSeriesIdFromUrl(url: string) {
    const m = url.match(/\/series\/[^/]+\/(.+)$/);
    if (m) return m[1];
}

function getMovieIdFromUrl(url: string) {
    const m = url.match(/\/movies\/[^/]+\/(.+)$/);
    if (m) return m[1];
}

function unpackSeriesFromResult(result: IQueryResult) {
    if (result.appName !== "DisneyApp") {
        throw new Error("Given QueryResult for wrong app");
    }

    const { url } = result;
    if (url == null) {
        throw new Error(`No url on query result: ${result.title}`);
    }

    return getSeriesIdFromUrl(url);
}

export class DisneyPlayerChannel implements IPlayerChannel<DisneyApp> {
    private readonly api: DisneyApi;

    constructor(options: IDisneyOpts) {
        this.api = new DisneyApi(options);
    }

    public ownsUrl(url: string): boolean {
        return url.includes("disneyplus.com");
    }

    public async createPlayable(url: string) {
        return this.createPlayableSync(url);
    }

    public async createEpisodeListingsFor(
        result: IQueryResult,
    ): Promise<IEpisodeListings | undefined> {
        const seriesId = unpackSeriesFromResult(result);
        if (seriesId == null) {
            // not a series
            return;
        }

        return new DisneyEpisodeListings(this.api, seriesId);
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        const seriesId = unpackSeriesFromResult(item);
        if (seriesId == null) {
            // not a series
            return;
        }

        const episodes = await this.api.getSeriesEpisodes(seriesId);
        const episode = await episodes.query(query);
        if (!episode) return;

        const queryResult = this.searchHitToQueryResult(episode, {
            playEpisodeDirectly: true,
        });
        if (!queryResult) return;

        const seriesTitle =
            episode.text.title?.full?.series?.default?.content ?? "";

        return {
            ...queryResult,

            seriesTitle,
        };
    }

    /**
     * Search for {@see Player.play}'able media by title
     */
    public async *queryByTitle(title: string): AsyncIterable<IQueryResult> {
        const hits = await this.api.search(title);

        for (const hit of hits) {
            const result = this.searchHitToQueryResult(hit);
            if (result) {
                yield result;
            }
        }
    }

    public async *queryRecent() {
        yield* this.queryCollectionType(new Set(["ContinueWatchingSet"]));
    }

    public async *queryRecommended() {
        yield* this.queryCollectionType(RECOMMENDATION_SET_TYPES);
    }

    public async *queryRecommendations(query?: IRecommendationQuery) {
        yield* filterRecommendations(
            query,
            this.queryCollectionType(RECOMMENDATION_SET_TYPES),
        );
    }

    private async *queryCollectionType(types: Set<CollectionSetType>) {
        const collections = await this.api.getCollections();
        const toFetch = collections.filter((coll) => types.has(coll.type));

        yield* mergeAsyncIterables(
            toFetch.map((coll) => this.collectionIterable(coll)),
        );
    }

    private async *collectionIterable(coll: ICollection) {
        const items = await this.api.loadCollection(coll);
        const info = this.collectionToRecommendationInfo(coll);

        for (const item of items) {
            const result = this.searchHitToQueryResult(item);
            if (result) {
                yield {
                    ...result,
                    ...info,
                };
            }
        }
    }

    private collectionToRecommendationInfo({ type, title }: ICollection) {
        switch (type) {
            case "BecauseYouSet":
                return {
                    recommendationType: RecommendationType.Interest,
                    recommendationCategoryTitle: title,
                };

            case "ContinueWatchingSet":
                return { recommendationType: RecommendationType.Recent };

            case "CuratedSet":
                return {
                    recommendationType: RecommendationType.Curated,
                    recommendationCategoryTitle: title,
                };

            case "RecommendationSet": // ?
                return {
                    recommendationType: RecommendationType.Popular,

                    recommendationCategoryTitle: title,
                };
        }
    }

    private searchHitToQueryResult(
        result: ISearchHit,
        {
            playEpisodeDirectly = false,
        }: {
            playEpisodeDirectly?: boolean;
        } = {},
    ) {
        const id = result.contentId;
        const isSeries = result.encodedSeriesId;
        const isMovie = !isSeries && result.programType === "movie";

        const slugContainer = result.text?.title?.slug;
        if (slugContainer == null) {
            debug("No slug for", result);
            return;
        }
        const textKey = playEpisodeDirectly
            ? "program" in slugContainer
                ? "program"
                : "series"
            : "series" in slugContainer
            ? "series"
            : "program";

        const titleObj = result.text.title?.full?.[textKey];
        const descObj = result.text.description?.full?.[textKey];
        const slugObj = slugContainer?.[textKey];

        if (!titleObj || !slugObj) {
            debug("No full title object for", result);
            return;
        }

        let url: string;
        if (isSeries && !playEpisodeDirectly) {
            url = `${SERIES_URL + slugObj.default.content}/${
                result.encodedSeriesId
            }`;
        } else if (isMovie && result.family) {
            url = `${MOVIE_URL + slugObj.default.content}/${
                result.family.encodedFamilyId
            }`;
        } else {
            debug("non-series result:", result);
            url = PLAYBACK_URL + id;
        }

        const cover = pickPreferredImage(result.image, textKey)?.url;

        return {
            appName: "DisneyApp",
            cover,
            desc: descObj ? descObj.default.content : undefined,
            title: titleObj.default.content,
            url,

            playable: this.createPlayableSync(url),
        };
    }

    private createPlayableSync(url: string) {
        // other urls?
        const videoMatch = url.match(/\/video\/(.+)$/);
        if (videoMatch && videoMatch[1]) {
            const id = videoMatch[1];

            return async (app: DisneyApp, _opts: IPlayableOptions) => {
                await app.playById(id);
            };
        }

        const seriesId = getSeriesIdFromUrl(url);
        if (seriesId) {
            return async (app: DisneyApp, opts: IPlayableOptions) =>
                app.playSeriesById(seriesId, opts);
        }

        const movieId = getMovieIdFromUrl(url);
        if (movieId) {
            return async (app: DisneyApp, opts: IPlayableOptions) =>
                app.playByFamilyId(movieId, opts);
        }

        throw new Error(`Unsure how to play ${url}`);
    }
}
