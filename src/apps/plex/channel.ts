import createDebug from "debug";

import { PlexApp } from ".";
import { IPlayableOptions, IPlayerChannel, IQueryResult } from "../../app";
import { PlexApi } from "./api";
import { IPlexOpts } from "./config";
import { IPlexItem } from "./model";

const debug = createDebug("babbling:plex:channel");

export class PlexPlayerChannel implements IPlayerChannel<PlexApp> {
    private api: PlexApi;

    constructor(
        private readonly options: IPlexOpts,
    ) {
        this.api = new PlexApi(this.options.token, this.options.clientIdentifier);
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

    public async* queryRecommended() {
        const items = await this.api.getContinueWatching();
        for (const item of items) {
            yield await this.itemToQueryResult(item);
        }
    }

    public async* queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        for (const item of await this.api.search(title)) {
            yield await this.itemToQueryResult(item);
        }
    }

    private async itemToQueryResult(item: IPlexItem): Promise<IQueryResult> {
        return {
            appName: "PlexApp",
            cover: item.thumb,
            playable: await this.createPlayable(item.uri),
            title: item.seriesTitle ?? item.title,
            url: item.uri,
        };
    }
}
