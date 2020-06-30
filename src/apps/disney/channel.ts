import _debug from "debug";
const debug = _debug("babbling:DisneyApp:channel");

import {
    // IEpisodeQuery,
    // IEpisodeQueryResult,
    IPlayableOptions,
    IPlayerChannel,
    IQueryResult,
} from "../../app";
import { mergeAsyncIterables } from "../../async";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import { DisneyApp, IDisneyOpts } from ".";
import { DisneyApi, ICollection, ISearchHit } from "./api";

const PLAYBACK_URL = "https://www.disneyplus.com/video/";
const SERIES_URL = "https://www.disneyplus.com/series/";

const RECOMMENDATION_SET_TYPES = new Set([
    "RecommendationSet",
    "ContinueWatchingSet",
]);

export class DisneyPlayerChannel implements IPlayerChannel<DisneyApp> {

    private readonly api: DisneyApi;

    constructor(
        readonly options: IDisneyOpts,
    ) {
        this.api = new DisneyApi(options);
    }

    public ownsUrl(url: string): boolean {
        return url.includes("disneyplus.com");
    }

    public async createPlayable(url: string) {
        return this.createPlayableSync(url);
    }

    /**
     * Search for {@see Player.play}'able media by title
     */
    public async *queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        const hits = await this.api.search(title);

        for (const hit of hits) {
            const result = this.searchHitToQueryResult(hit);
            if (result) {
                yield result;
            }
        }
    }

    public async *queryRecommended() {
        const collections = await this.api.getCollections();
        const toFetch = collections.filter(coll =>
            RECOMMENDATION_SET_TYPES.has(coll.type));

        yield *mergeAsyncIterables(toFetch.map(coll =>
            this.collectionIterable(coll),
        ));
    }

    private async *collectionIterable(coll: ICollection) {
        const items = await this.api.loadCollection(coll);
        for (const item of items) {
            const result = this.searchHitToQueryResult(item);
            if (result) {
                yield result;
            }
        }
    }

    private searchHitToQueryResult(result: ISearchHit) {
        const id = result.contentId;
        const titleObj = result.texts.find(item => {
            return item.field === "title" && item.type === "full";
        });
        const descObj = result.texts.find(item => {
            return item.field === "description" && item.type === "full";
        });

        if (!titleObj) {
            debug("No full title object for", result);
            return;
        }

        let url: string;
        if (result.encodedSeriesId) {
            const slugObj = result.texts.find(item => {
                return item.field === "title" && item.type === "slug";
            });
            url = SERIES_URL + slugObj!!.content + "/" + result.encodedSeriesId;
        } else {
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

            return async (app: DisneyApp, opts: IPlayableOptions) => {
                await app.playById(id);
            };
        }

        const seriesMatch = url.match(/\/series\/[^\/]+\/(.+)$/);
        if (seriesMatch && seriesMatch[1]) {
            const seriesId = seriesMatch[1];

            return async (app: DisneyApp, opts: IPlayableOptions) => {
                return app.playSeriesById(seriesId);
            };
        }

        throw new Error(`Unsure how to play ${url}`);
    }

}
