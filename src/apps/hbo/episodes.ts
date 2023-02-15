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
import {
    createPlayableFromUrn,
    formatCoverImage,
    urnFromQueryResult,
} from "./playable";

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
                    // NOTE: HBO does return URLs for season images, but they
                    // just resolve to the HBO Max logo
                    debug("season=", season);
                    return {
                        appName: "HboApp",
                        desc: season.body.summaries?.full,
                        title:
                            season.body.titles?.full ??
                            `Season ${season.body.seasonNumber}`,
                        playable: await createPlayableFromUrn(
                            this.api,
                            season.id,
                        ),
                        url: urlForUrn(unpackUrn(season.id)),
                    };
                }),
        );
    }

    public async listEpisodesInSeason(season: IQueryResult) {
        const urn = urnFromQueryResult(season);
        const items = await this.api.fetchContent([urn]); // TODO
        const rawEpisodes = items.filter(
            (item) =>
                entityTypeFromUrn(item.id) === "episode" &&
                item.body.references?.season === urn,
        );
        rawEpisodes.sort(
            (a, b) =>
                (a.body.numberInSeason ?? 0) - (b.body.numberInSeason ?? 0),
        );

        return Promise.all(
            rawEpisodes.map(async (episode) => {
                return {
                    appName: "HboApp",
                    cover: formatCoverImage(episode.body.images?.tile),
                    desc: episode.body.summaries?.full,
                    title:
                        episode.body.titles?.full ??
                        `Season ${episode.body.seasonNumber}`,
                    playable: await createPlayableFromUrn(this.api, episode.id),
                    url: urlForUrn(unpackUrn(episode.id)),
                };
            }),
        );
    }
}
