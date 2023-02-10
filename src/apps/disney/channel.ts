import _debug from "debug";

import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayableOptions,
    IPlayerChannel,
    IQueryResult,
    RecommendationType,
} from "../../app";
import { mergeAsyncIterables } from "../../async";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import type { DisneyApp, IDisneyOpts } from ".";
import { DisneyApi, ICollection, ISearchHit } from "./api";

const debug = _debug("babbling:DisneyApp:channel");

const PLAYBACK_URL = "https://www.disneyplus.com/video/";
const SERIES_URL = "https://www.disneyplus.com/series/";
const MOVIE_URL = "https://www.disneyplus.com/movies/";

const RECOMMENDATION_SET_TYPES = new Set([
    "RecommendationSet",
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

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        if (item.appName !== "DisneyApp") {
            throw new Error("Given QueryResult for wrong app");
        }

        const { url } = item;
        if (url == null) {
            throw new Error(`No error on query result: ${item.title}`);
        }

        const seriesId = getSeriesIdFromUrl(url);
        if (!seriesId) {
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

        const seriesTitleObj = episode.texts.find(
            (text) =>
                text.field === "title" &&
                text.type === "full" &&
                text.sourceEntity === "series",
        );
        const seriesTitle = seriesTitleObj ? seriesTitleObj.content : "";

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

    public async *queryRecommendations() {
        yield* this.queryCollectionType(RECOMMENDATION_SET_TYPES);
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
        for (const item of items) {
            const result = this.searchHitToQueryResult(item);
            if (result) {
                yield { ...result, recommendationType: RecommendationType.New };
            }
        }
    }

    private collectionTypeToRecommendationInfo(type: CollectionSetType) {
        switch (type) {
            case "BecauseYouSet":
                return { recommendationType: RecommendationType.Interest };

            case "ContinueWatchingSet":
                return { recommendationType: RecommendationType.Recent };

            case "CuratedSet":
                return { RecommendationType: RecommendationType.Curated };

            case "RecommendationSet": // ?
                return { recommendationType: RecommendationType.Popular };
        }
    }

    private searchHitToQueryResult(
        result: ISearchHit,
        {
            playEpisodeDirectly,
        }: {
            playEpisodeDirectly?: boolean;
        } = {},
    ) {
        const id = result.contentId;
        const isSeries = result.encodedSeriesId;
        const isMovie = !isSeries && result.programType === "movie";
        const sourceEntity =
            isMovie || (isSeries && playEpisodeDirectly) ? "program" : null;

        const filteredTexts = result.texts.filter(
            (item) => !sourceEntity || item.sourceEntity === sourceEntity,
        );
        const titleObj = filteredTexts.find(
            (item) => item.field === "title" && item.type === "full",
        );
        const descObj = filteredTexts.find(
            (item) => item.field === "description" && item.type === "full",
        );

        if (!titleObj) {
            debug("No full title object for", result);
            return;
        }

        let url: string;
        if (isSeries && !playEpisodeDirectly) {
            const slugObj =
                result.texts.find(
                    (item) => item.field === "title" && item.type === "slug",
                ) ?? ({} as any);
            url = `${SERIES_URL + slugObj.content}/${result.encodedSeriesId}`;
        } else if (isMovie && result.family) {
            const slugObj =
                result.texts.find(
                    (item) => item.field === "title" && item.type === "slug",
                ) ?? ({} as any);
            url = `${MOVIE_URL + slugObj.content}/${
                result.family.encodedFamilyId
            }`;
        } else {
            debug("non-series result:", result);
            url = PLAYBACK_URL + id;
        }

        return {
            appName: "DisneyApp",
            desc: descObj ? descObj.content : undefined,
            title: titleObj.content,
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
