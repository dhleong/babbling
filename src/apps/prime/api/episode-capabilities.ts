import _debug from "debug";

import { IEpisodeBase } from "../../../util/episode-container";
import { IEpisodeCapabilities } from "../../../util/episode-resolver";

import { ITitleInfo, PrimeApi } from "../api";

const debug = _debug("babbling:prime:episodes");

function mapEpisodes(info: ITitleInfo) {
    if (info.episodes == null) {
        return [];
    }

    return info.episodes
        .filter(raw => raw.episodeNumber >= 1)
        .map(raw => ({
            indexInSeason: raw.episodeNumber - 1,
            season: raw.seasonNumber - 1,
            title: raw.title,
            titleId: raw.titleId,
        }));
}

export interface IPrimeEpisode extends IEpisodeBase {
    titleId: string;
}

export class PrimeEpisodeCapabilities implements IEpisodeCapabilities<IPrimeEpisode> {
    constructor(
        private readonly api: PrimeApi,
        private readonly seriesTitleId: string,
    ) {}

    public async* episodesInSeason(seasonIndex: number) {
        const seasonNumber = seasonIndex + 1;
        const info = await this.api.getTitleInfo(this.seriesTitleId);
        if (!info.series) return;

        debug(`fetching season ${seasonNumber} of ${info.series.title}`);

        // do we already have the right season?
        if (
            info.episodes
            && info.episodes.length
            && info.episodes[0].seasonNumber === seasonNumber
        ) {
            debug(`already have season ${seasonNumber}`);
            yield mapEpisodes(info);
            return;
        }

        // need to fetch the appropriate season, if possible
        if (!info.seasonIds || info.seasonIds.length <= seasonIndex) return;
        debug(`seasons of ${info.series.title} = ${info.seasonIds}`);

        const seasonId = info.seasonIds[seasonIndex];
        debug(`fetching season#${seasonIndex}: ${seasonId}`);
        const season = await this.api.getTitleInfo(seasonId);

        if (season.episodes) {
            yield mapEpisodes(season);
        }
    }
}
