import createDebug from "debug";

import { ISeriesContentListings, IQueryResult } from "../../app";
import { PlexApi } from "./api";
import { buildItemUri, IPlexServer, parseItemMetadata } from "./model";
import { createPlayableForUri } from "./playable";

const debug = createDebug("babbling:plex:listings");

export class PlexContentListings implements ISeriesContentListings {
    constructor(
        private readonly api: PlexApi,
        private readonly server: IPlexServer,
        private readonly item: any,
    ) {}

    public async listSeasons(): Promise<IQueryResult[]> {
        const { items } = await this.api.getApiItemsByUri(
            buildItemUri(this.server, this.item.key, { forChildren: true }),
        );
        return this.buildResultsFromApiItems(items);
    }

    public async listEpisodesInSeason(
        result: IQueryResult,
    ): Promise<IQueryResult[]> {
        if (result.appName !== "PlexApp") {
            throw new Error(
                `Received QueryResult for wrong app: ${result.appName}`,
            );
        }
        if (result.url == null) {
            throw new Error("Invalid QueryResult; missing url");
        }

        const { items } = await this.api.getApiItemsByUri(
            result.url + "/children",
        );
        return this.buildResultsFromApiItems(items);
    }

    private buildResultsFromApiItems(items: any[]) {
        return items.map((apiItem) => {
            const item = parseItemMetadata(this.server, apiItem, {
                resolveRoot: false,
            });
            debug("apiItem", apiItem, " => ", item);
            return {
                appName: "PlexApp",
                cover: item.thumb,
                desc: item.desc,
                playable: createPlayableForUri(item.uri),
                title: item.title,
                url: item.uri,
            };
        });
    }
}
