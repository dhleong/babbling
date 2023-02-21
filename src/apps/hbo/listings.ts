import createDebug from "debug";

import type { ISeriesContentListings, IQueryResult } from "../../app";
import Shared from "../../util/Shared";
import {
    entityTypeFromUrn,
    HboApi,
    IHboRawItem,
    pageUrnFrom,
    unpackUrn,
    urlForUrn,
} from "./api";
import {
    createPlayableFromUrn,
    formatCoverImage,
    urnFromQueryResult,
} from "./playable";

const debug = createDebug("babbling:hbo:episodes");

export class HboContentListings implements ISeriesContentListings {
    private readonly seasonListings: Shared<IHboRawItem[]>;
    private readonly episodeListings: Shared<IHboRawItem[]>;

    constructor(private readonly api: HboApi, public readonly urn: string) {
        this.seasonListings = new Shared(() => this.api.fetchContent([urn]));
        this.episodeListings = new Shared(() =>
            this.api.fetchExpressContent(pageUrnFrom(urn)),
        );
    }

    public async listSeasons(): Promise<IQueryResult[]> {
        const items = await this.seasonListings.get();
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
        const [items, resolvedSeason] = await Promise.all([
            this.episodeListings.get(),
            this.resolveSeasonItem(urnFromQueryResult(season)),
        ]);

        debug("Resolved season", season, " to ", resolvedSeason);

        const rawEpisodes = items.filter(
            (item) =>
                entityTypeFromUrn(item.id) === "episode" &&
                item.body.seasonNumber === resolvedSeason.body.seasonNumber,
        );
        rawEpisodes.sort(
            (a, b) =>
                (a.body.numberInSeason ?? 0) - (b.body.numberInSeason ?? 0),
        );

        // NOTE: For some reason, naively doing fetchContent([seasonUrn]) does not
        // consistently return all episodes for that season; using the express-content
        // endpoint for the series returns *every* episode in the *series*, but omits
        // things like `summaries`...

        return Promise.all(
            rawEpisodes.map(async (episode) => {
                return {
                    appName: "HboApp",
                    cover: formatCoverImage(episode.body.images?.tile),
                    desc: episode.body.summaries?.full,
                    title:
                        episode.body.titles?.full ??
                        `Episode ${episode.body.numberInSeason}`,
                    playable: await createPlayableFromUrn(this.api, episode.id),
                    url: urlForUrn(unpackUrn(episode.id)),
                };
            }),
        );
    }

    private async resolveSeasonItem(urn: string) {
        const listings = await this.seasonListings.get();
        const season = listings.find((item) => item.id === urn);
        if (season == null) {
            throw new Error(`Invalid season ID '${urn}'`);
        }
        return season;
    }
}
