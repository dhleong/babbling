import createDebug from "debug";

import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
    IRecommendationQuery,
    RecommendationType,
} from "../../app";
import { EpisodeResolver } from "../../util/episode-resolver";

import type { HboApp, IHboOpts } from ".";
import {
    entityTypeFromUrn,
    HboApi,
    IHboResult,
    unpackUrn,
    urlForUrn,
} from "./api";
import withRecommendationType from "../../util/withRecommendationType";
import filterRecommendations from "../../util/filterRecommendations";
import { HboEpisodeListings } from "./episodes";
import {
    createPlayableFromUrn,
    formatCoverImage,
    urnFromQueryResult,
    urnFromUrl,
} from "./playable";

const debug = createDebug("babbling:hbo:channel");

export class HboPlayerChannel implements IPlayerChannel<HboApp> {
    private api: HboApi;

    constructor(private readonly options: IHboOpts) {
        this.api = new HboApi(this.options.token);
    }

    public ownsUrl(url: string) {
        return url.includes("play.hbomax.com") || url.startsWith("urn:hbo:");
    }

    public async createPlayable(url: string) {
        const urn = urnFromUrl(url);
        return createPlayableFromUrn(this.api, urn);
    }

    public async createEpisodeListingsFor(item: IQueryResult) {
        const urn = urnFromQueryResult(item);
        if (entityTypeFromUrn(urn) !== "series") return; // cannot have it

        return new HboEpisodeListings(this.api, urn);
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        const urn = urnFromQueryResult(item);
        if (entityTypeFromUrn(urn) !== "series") return; // cannot have it

        const resolver = new EpisodeResolver({
            container: () => this.api.getEpisodesForSeries(urn),
        });
        const episode = await resolver.query(query);
        if (!episode) return;

        debug("found episode", query, episode);
        const url = `https://play.hbomax.com/${episode.urn}`;
        return {
            appName: "HboApp",
            playable: await this.createPlayable(url),
            seriesTitle: item.title,
            title: episode.title,
            url,
        };
    }

    public async *queryByTitle(title: string): AsyncIterable<IQueryResult> {
        for await (const item of this.api.search(title)) {
            if (entityTypeFromUrn(item.urn) === "episode") {
                // Don't emit episodes; this method is for
                // finding series and movies only
                continue;
            }

            yield await this.hboToQueryResult(item);
        }
    }

    public async *queryRecent() {
        yield* this.yieldPlayables(this.api.queryContinueWatching());
    }

    public async *queryRecommendations(query?: IRecommendationQuery) {
        yield* filterRecommendations(
            query,
            withRecommendationType(
                RecommendationType.Interest,
                this.yieldPlayables(this.api.queryRecommended()),
            ),
        );
    }

    public async *queryRecommended() {
        // NOTE: Legacy behavior:
        yield* this.queryRecent();
    }

    private async *yieldPlayables(source: ReturnType<typeof this.api.search>) {
        for await (const result of source) {
            yield await this.hboToQueryResult(result);
        }
    }

    private async hboToQueryResult(source: IHboResult): Promise<IQueryResult> {
        // HBO Max may use a slightly different URN structure for the
        // series / movie page than it emits in the search result
        const urn = unpackUrn(source.seriesUrn ?? source.urn);
        const url = urlForUrn(urn);
        const title = source.seriesTitle ?? source.title;

        return {
            appName: "HboApp",
            cover: formatCoverImage(source.imageTemplate),
            playable: await this.createPlayable(url),
            title,
            url,
        };
    }
}
