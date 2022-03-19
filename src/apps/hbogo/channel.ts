import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
} from "../../app";
import { EpisodeResolver } from "../../util/episode-resolver";

import type { HboGoApp, IHboGoOpts } from ".";
import { entityTypeFromUrn, HboGoApi } from "./api";

function urnFromUrl(url: string) {
    return url.substring(url.lastIndexOf("/") + 1);
}

export class HboGoPlayerChannel implements IPlayerChannel<HboGoApp> {
    private api: HboGoApi;

    constructor(
        private readonly options: IHboGoOpts,
    ) {
        this.api = new HboGoApi(this.options.token);
    }

    public ownsUrl(url: string) {
        return url.includes("play.hbogo.com");
    }

    public async createPlayable(url: string) {
        const urn = urnFromUrl(url);
        try {
            switch (entityTypeFromUrn(urn)) {
                case "series":
                    return async (app: HboGoApp) => app.resumeSeries(urn);

                case "episode":
                case "extra":
                case "feature":
                case "season":
                // TODO: it may be possible to resume specific episodes or
                // features (movies)...
                    return async (app: HboGoApp) => app.play(urn);
            }
        } catch (e) {
            throw new Error(`'${urn}' doesn't look playable`);
        }
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        if (item.appName !== "HboGoApp") {
            throw new Error("Given QueryResult for wrong app");
        } else if (item.url == null) {
            throw new Error(`Given query result has no URL: ${item.title}`);
        }

        const urn = urnFromUrl(item.url);
        if (entityTypeFromUrn(urn) !== "series") return; // cannot have it

        const resolver = new EpisodeResolver({
            container: () => this.api.getEpisodesForSeries(urn),
        });
        const episode = await resolver.query(query);
        if (!episode) return;

        const url = `https://play.hbogo.com/${episode.urn}`;
        return {
            appName: "HboGoApp",
            playable: await this.createPlayable(url),
            seriesTitle: item.title,
            title: episode.title,
            url,
        };
    }

    public async* queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        for await (const result of this.api.search(title)) {
            const url = `https://play.hbogo.com/${result.urn}`;
            yield {
                appName: "HboGoApp",
                playable: await this.createPlayable(url),
                title: result.title,
                url,
            };
        }
    }
}
