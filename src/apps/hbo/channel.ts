import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
} from "../../app";
import { EpisodeResolver } from "../../util/episode-resolver";

import type { HboApp, IHboOpts } from ".";
import { entityTypeFromUrn, HboApi } from "./api";

function urnFromUrl(url: string) {
    return url.substring(url.lastIndexOf("/") + 1);
}

export class HboPlayerChannel implements IPlayerChannel<HboApp> {
    private api: HboApi;

    constructor(
        private readonly options: IHboOpts,
    ) {
        this.api = new HboApi(this.options.token);
    }

    public ownsUrl(url: string) {
        return url.includes("play.hbomax.com");
    }

    public async createPlayable(url: string) {
        const urn = urnFromUrl(url);
        try {
            switch (entityTypeFromUrn(urn)) {
                case "series":
                    return async (app: HboApp) => app.resumeSeries(urn);

                case "episode":
                case "extra":
                case "feature":
                case "season":
                // TODO: it may be possible to resume specific episodes or
                // features (movies)...
                    return async (app: HboApp) => app.play(urn);
            }
        } catch (e) {
            throw new Error(`'${urn}' doesn't look playable`);
        }
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        if (item.appName !== "HboApp") {
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

        const url = `https://play.hbomax.com/${episode.urn}`;
        return {
            appName: "HboApp",
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
            if (result.type === "SERIES_EPISODE") {
                // Don't emit episodes; this method is for
                // finding series and movies only
                continue;
            }

            const url = `https://play.hbomax.com/${result.urn}`;
            yield {
                appName: "HboApp",
                playable: await this.createPlayable(url),
                title: result.title,
                url,
            };
        }
    }
}
