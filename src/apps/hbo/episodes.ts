import createDebug from "debug";

import type { IEpisodeListings, IQueryResult } from "../../app";
import Shared from "../../util/Shared";
import {
    entityTypeFromUrn,
    HboApi,
    IHboRawItem,
    unpackUrn,
    urlForUrn,
} from "./api";
import { createPlayableFromUrn, formatCoverImage } from "./playable";

const debug = createDebug("babbling:hbo:episodes");

export class HboEpisodeListings implements IEpisodeListings {
    private readonly listings: Shared<IHboRawItem[]>;

    constructor(private readonly api: HboApi, public readonly urn: string) {
        this.listings = new Shared(() => this.api.fetchContent([urn]));
    }

    public async listSeasons(): Promise<IQueryResult[]> {
        const items = await this.listings.get();
        return Promise.all(
            items
                .filter((item) => entityTypeFromUrn(item.id) === "season")
                .map(async (season) => {
                    debug("season=", season);
                    return {
                        appName: "HboApp",
                        cover: formatCoverImage(season.body.images?.tile),
                        desc: season.body.summaries?.full,
                        title: season.body.titles?.full ?? "Season ...",
                        playable: await createPlayableFromUrn(
                            this.api,
                            season.id,
                        ),
                        url: urlForUrn(unpackUrn(season.id)),
                    };
                }),
        );
    }

    public async listEpisodesInSeason(_season: IQueryResult) {
        // TODO
        return [];
    }
}
