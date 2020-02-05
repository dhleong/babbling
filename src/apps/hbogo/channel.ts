import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
} from "../../app";

import { HboGoApp, IHboGoOpts } from ".";
import { entityTypeFromUrn, HboGoApi } from "./api";

export class HboGoPlayerChannel implements IPlayerChannel<HboGoApp> {

    constructor(
        private readonly options: IHboGoOpts,
    ) {}

    public ownsUrl(url: string) {
        return url.includes("play.hbogo.com");
    }

    public async createPlayable(url: string) {
        const urn = url.substring(url.lastIndexOf("/") + 1);
        try {
            switch (entityTypeFromUrn(urn)) {
            case "series":
                return async (app: HboGoApp) => app.resumeSeries(urn);

            case "episode":
            case "extra":
            case "feature":
                // TODO: it may be possible to resume specific episodes or
                // features (movies)...
                return async (app: HboGoApp) => app.play(urn);
            }

        } catch (e) {
            throw new Error(`'${urn}' doesn't look playable`);
        }

        throw new Error(`Not sure how to play '${urn}'`);
    }

    public async *queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        const api = new HboGoApi(this.options.token);
        for await (const result of api.search(title)) {
            const url = "https://play.hbogo.com/" + result.urn;
            yield {
                appName: "HboGoApp",
                playable: await this.createPlayable(url),
                title: result.title,
                url,
            };
        }
    }

    public async *queryEpisodeForTitle(
        title: string,
        query: IEpisodeQuery,
    ): AsyncIterable<IEpisodeQueryResult> {
        const api = new HboGoApi(this.options.token);

        for await (const result of api.search(title)) {
            if (entityTypeFromUrn(result.urn) !== "series") {
                continue;
            }

            const episodes = await api.getEpisodesForSeries(result.urn);
            const episode = episodes.get(query);
            if (!episode) continue;

            const url = "https://play.hbogo.com/" + episode.urn;
            yield {
                appName: "HboGoApp",
                playable: await this.createPlayable(url),
                seriesTitle: result.title,
                title: episode.title,
                url,
            };
        }
    }
}
