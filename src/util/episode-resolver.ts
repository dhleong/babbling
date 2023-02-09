import { IEpisodeQuery } from "../app";

import { EpisodeContainer, IEpisodeBase } from "./episode-container";

export interface IEpisodeCapabilities<TEpisode extends IEpisodeBase> {
    container?(): Promise<EpisodeContainer<TEpisode>>;

    /**
     * Yields batches of episodes, to support paginated implementations
     */
    episodesInSeason?(seasonIndex: number): AsyncIterable<TEpisode[]>;
}

export class EpisodeResolver<TEpisode extends IEpisodeBase> {
    constructor(private capabilities: IEpisodeCapabilities<TEpisode>) {}

    public async query(query: IEpisodeQuery) {
        if (this.capabilities.container) {
            const container = await this.capabilities.container();
            return container.get(query);
        }

        if (
            query.seasonIndex !== undefined &&
            this.capabilities.episodesInSeason
        ) {
            const batches = this.capabilities.episodesInSeason(
                query.seasonIndex,
            );
            let offset = 0;
            for await (const batch of batches) {
                if (query.episodeIndex - offset < batch.length) {
                    return batch[query.episodeIndex - offset];
                }
                offset += batch.length;
            }

            // no such episode in this season
        }
    }
}
