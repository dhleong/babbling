import { ISeriesContentListings, IQueryResult } from "../../app";
import { DisneyApi, pickPreferredImage } from "./api";
import {
    createPlayableFromUrl,
    createVideoPlaybackUrl,
    getSeriesIdFromUrl,
} from "./playable";

export class DisneyContentListings implements ISeriesContentListings {
    constructor(
        private readonly api: DisneyApi,
        private readonly seriesUrl: string,
    ) {}

    public async listSeasons(): Promise<IQueryResult[]> {
        const seriesId = getSeriesIdFromUrl(this.seriesUrl);
        if (seriesId == null) {
            throw new Error(`Invalid series URL: ${this.seriesUrl}`);
        }

        const seasons = await this.api.getSeriesSeasons(seriesId);
        return seasons.map((season: any) => ({
            appName: "DisneyApp",
            title: `Season ${season.seasonSequenceNumber}`,
            playable: () => {
                throw new Error("Season is not directly playable");
            },
            url: this.seriesUrl + "?seasonId=" + season.seasonId,
        }));
    }

    public async listEpisodesInSeason(
        season: IQueryResult,
    ): Promise<IQueryResult[]> {
        if (season.appName !== "DisneyApp") {
            throw new Error(
                `Invalid query result: given for app ${season.appName}`,
            );
        }

        const { url } = season;
        if (url == null) {
            throw new Error(`Invalid query result; no url for ${season.title}`);
        }

        const seriesId = url == null ? undefined : getSeriesIdFromUrl(url);
        if (seriesId == null) {
            throw new Error(`Invalid series URL: ${url}`);
        }

        const urlObj = new URL(url);
        const seasonId = urlObj.searchParams.get("seasonId");
        if (seasonId == null) {
            throw new Error("Invalid query result; no season ID");
        }

        const episodes: IQueryResult[] = [];

        for await (const episode of this.api.getSeasonEpisodesById(
            seriesId,
            seasonId,
        )) {
            const episodeUrl = createVideoPlaybackUrl(episode.contentId);
            episodes.push({
                appName: "DisneyApp",
                title:
                    episode.text.title?.full?.program?.default?.content ?? "",
                desc: episode.text.description?.full?.program?.default?.content,
                cover: pickPreferredImage(episode.image, "program")?.url,
                playable: createPlayableFromUrl(episodeUrl),
                url,
            });
        }

        return episodes;
    }
}
