import createDebug from "debug";

import type { IEpisodeListings, IQueryResult } from "../../app";
import type { ITitleInfo, PrimeApi } from "./api";
import { pickTitleIdFromUrl, playableFromTitleId, urlFor } from "./playable";

const debug = createDebug("babbling:prime:episodes");

export class PrimeEpisodeListings implements IEpisodeListings {
    constructor(
        private readonly api: PrimeApi,
        private readonly title: ITitleInfo,
    ) {}

    public async listSeasons(): Promise<IQueryResult[]> {
        const { seasons } = this.title;
        if (seasons == null) {
            return [];
        }

        return seasons.map((season) => {
            return {
                appName: "PrimeApp",
                title: season.title,
                playable: playableFromTitleId(season.titleId),
                url: urlFor(season),
            };
        });
    }

    public async listEpisodesInSeason(
        result: IQueryResult,
    ): Promise<IQueryResult[]> {
        if (result.appName !== "PrimeApp") {
            throw new Error(`Received unexpected appName: ${result.appName}`);
        }
        if (result.url == null) {
            throw new Error(`Missing url for query result: ${result.title}`);
        }

        const titleId = pickTitleIdFromUrl(result.url);
        if (!titleId) {
            throw new Error(`Unsure how to play ${result.url}`);
        }
        const titleInfo = await this.api.getTitleInfo(titleId);
        debug("episodes=", titleInfo);

        if (titleInfo.episodes == null) {
            return [];
        }

        return titleInfo.episodes.map((episode) => ({
            appName: "PrimeApp",
            title: episode.title,
            playable: playableFromTitleId(episode.titleId),
            url: urlFor(episode),
        }));
    }
}
