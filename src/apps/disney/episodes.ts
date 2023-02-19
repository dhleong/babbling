import { IEpisodeListings, IQueryResult } from "../../app";
import { DisneyApi } from "./api";

export class DisneyEpisodeListings implements IEpisodeListings {
    constructor(
        private readonly api: DisneyApi,
        private readonly seriesId: string,
    ) {}

    public async listSeasons(): Promise<IQueryResult[]> {
        const seasons = await this.api.getSeriesSeasons(this.seriesId);
        console.log(seasons);
        return [];
    }

    public async listEpisodesInSeason(
        _season: IQueryResult,
    ): Promise<IQueryResult[]> {
        throw new Error("Method not implemented.");
    }
}
