import { IEpisodeListings, IQueryResult } from "../../app";
import { DisneyApi } from "./api";
import { getSeriesIdFromUrl } from "./playable";

export class DisneyEpisodeListings implements IEpisodeListings {
    constructor(
        private readonly api: DisneyApi,
        private readonly seriesUrl: string,
    ) {}

    public async listSeasons(): Promise<IQueryResult[]> {
        const seriesId = getSeriesIdFromUrl(this.seriesUrl);
        if (seriesId == null) {
            throw new Error(`Invalid series URL: ${this.seriesUrl}`);
        }

        const seasons: any[] = await this.api.getSeriesSeasons(seriesId);
        console.log(seasons);
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
        _season: IQueryResult,
    ): Promise<IQueryResult[]> {
        throw new Error("Method not implemented.");
    }
}
