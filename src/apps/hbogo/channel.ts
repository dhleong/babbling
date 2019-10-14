import { IPlayerChannel, IQueryResult } from "../../app";

import { HboGoApp, IHboGoOpts } from ".";
import { HboGoApi } from "./api";

export class HboGoPlayerChannel implements IPlayerChannel<HboGoApp> {
    public ownsUrl(url: string) {
        return url.includes("play.hbogo.com");
    }

    public async createPlayable(url: string) {
        const urn = url.substring(url.lastIndexOf("/") + 1);
        try {
            const [ , , entityType ] = urn.split(":");

            switch (entityType) {
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
        opts: IHboGoOpts,
    ): AsyncIterable<IQueryResult> {
        const api = new HboGoApi(opts.token);
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
}
