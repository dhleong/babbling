import createDebug from "debug";

import { PlexApp } from ".";
import {
    IPlayableOptions,
    IPlayerChannel,
    IQueryResult,
    RecommendationType,
} from "../../app";
import withRecommendationType from "../../util/withRecommendationType";
import { PlexApi } from "./api";
import { IPlexOpts } from "./config";
import { IPlexItem } from "./model";

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
        return async (app: PlexApp, opts: IPlayableOptions) => {
            debug("resuming on plex: ", url);
            return app.resumeByUri(url, {
                // TODO language options?
                startTime: opts.resume === false ? 0 : undefined,
            });
        };
    }

    public async *queryRecent() {
        yield* this.yieldQueryResults(this.api.getContinueWatching());
    }

    public async *queryRecommended() {
        // NOTE: Legacy behavior:
        yield* this.queryRecent();
    }

    public async *queryRecommendations() {
        yield* withRecommendationType(
            this.queryRecent(),
            RecommendationType.Recent,
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
