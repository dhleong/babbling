import { IEpisodeListings, IQueryResult } from "../../app";
import { HuluApi } from "./api";
import { createUrl, pickArtwork, playableForVideoId } from "./playable";

export class HuluEpisodeListings implements IEpisodeListings {
    constructor(
        private readonly api: HuluApi,
        private readonly seriesId: string,
    ) {}

    public async listSeasons(): Promise<IQueryResult[]> {
        const seasons = await this.api.getSeasons(this.seriesId);
        return seasons.map((season) => {
            return {
                appName: "HuluApp",
                url: season.url,
                title: season.title,
                seasonNumber: season.seasonNumber,

                playable: () => {
                    throw new Error("Season is not playable (?)");
                },
            };
        });
    }

    public async listEpisodesInSeason(season: IQueryResult) {
        const { url } = season;
        if (url == null) {
            throw new Error("No url for result");
        }

        const path = new URL(url).pathname.split("/");
        const seasonNumber = parseInt(path[path.length - 1], 10);

        const episodes: IQueryResult[] = [];

        for await (const episode of this.api.episodesInSeason(
            this.seriesId,
            seasonNumber,
        )) {
            episodes.push({
                appName: "HuluApp",
                cover: pickArtwork(episode),
                desc: episode.desc,
                title: episode.name,
                url: createUrl("watch", episode.id),

                playable: playableForVideoId(episode.id),
            });
        }

        return episodes;
    }
}
