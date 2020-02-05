import { IEpisodeQuery } from "../app";

export interface IEpisodeBase {
    season: number;
    indexInSeason: number;
}

interface ISeason<TEpisode extends IEpisodeBase> {
    index: number;
    episodes: TEpisode[];
}

export class EpisodeContainer<TEpisode extends IEpisodeBase> {
    private allEpisodes: TEpisode[] = [];
    private seasons: Array<ISeason<TEpisode>> = [];

    public add(episode: TEpisode) {
        this.allEpisodes.push(episode);
        while (episode.season >= this.seasons.length) {
            this.seasons.push({
                episodes: [],
                index: this.seasons.length,
            });
        }

        this.seasons[episode.season].episodes.push(episode);
    }

    public get(query: IEpisodeQuery) {
        if (
            query.seasonIndex !== undefined
            && query.episodeIndex !== undefined
        ) {
            return this.byIndices(query.seasonIndex, query.episodeIndex);
        }
    }

    private byIndices(season: number, episode: number) {
        if (season >= this.seasons.length) return;

        const seasonObj = this.seasons[season];
        if (episode >= seasonObj.episodes.length) return;

        return seasonObj.episodes[episode];
    }

}
