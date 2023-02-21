import createDebug from "debug";

import { PlexApp } from ".";
import {
    ISeriesContentListings,
    IPlayerChannel,
    IQueryResult,
    IRecommendationQuery,
    RecommendationType,
} from "../../app";
import filterRecommendations from "../../util/filterRecommendations";
import withRecommendationType from "../../util/withRecommendationType";
import { PlexApi } from "./api";
import { IPlexOpts } from "./config";
import { PlexContentListings } from "./listings";
import { IPlexItem } from "./model";
import { createPlayableForUri } from "./playable";

const debug = createDebug("babbling:plex:channel");

export class PlexPlayerChannel implements IPlayerChannel<PlexApp> {
    private api: PlexApi;

    constructor(private readonly options: IPlexOpts) {
        this.api = new PlexApi(
            this.options.token,
            this.options.clientIdentifier,
        );
    }

    public ownsUrl(url: string): boolean {
        return url.startsWith("plex");
    }

    public async createPlayable(url: string) {
        return createPlayableForUri(url);
    }

    public async createContentListingsFor(
        result: IQueryResult,
    ): Promise<ISeriesContentListings | undefined> {
        if (result.appName !== "PlexApp") {
            throw new Error(
                `QueryResult from wrong app (${result.appName}) provided to PlexPlayerChannel`,
            );
        }
        if (result.url == null) {
            throw new Error("Invalid query result; missing url");
        }

        const { server, item } = await this.api.getApiItemByUri(result.url);
        if (item.type !== "show") {
            debug("item not a series: type=", item.type);
            return undefined;
        }

        return new PlexContentListings(this.api, server, item);
    }

    public async *queryRecent() {
        yield* this.yieldQueryResults(this.api.getContinueWatching());
    }

    public async *queryRecommended() {
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

    public async *queryByTitle(title: string): AsyncIterable<IQueryResult> {
        yield* this.yieldQueryResults(this.api.search(title));
    }

    private async *yieldQueryResults(items: Promise<IPlexItem[]>) {
        for (const item of await items) {
            yield await this.itemToQueryResult(item);
        }
    }

    private async itemToQueryResult(item: IPlexItem): Promise<IQueryResult> {
        return {
            appName: "PlexApp",
            cover: item.thumb,
            desc: item.desc,
            playable: await this.createPlayable(item.uri),
            title: item.seriesTitle ?? item.title,
            url: item.uri,
        };
    }
}
