import {
    // IEpisodeQuery,
    // IEpisodeQueryResult,
    IPlayableOptions,
    IPlayerChannel,
    // IQueryResult,
} from "../../app";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import { DisneyApp, IDisneyOpts } from ".";

export class DisneyPlayerChannel implements IPlayerChannel<DisneyApp> {

    constructor(
        readonly options: IDisneyOpts,
    ) {}

    public ownsUrl(url: string): boolean {
        return url.includes("disneyplus.com");
    }

    public async createPlayable(url: string) {
        // TODO other urls
        const videoMatch = url.match(/\/video\/(.+)$/);
        if (!videoMatch || !videoMatch[1]) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const id = videoMatch[1];

        return async (app: DisneyApp, opts: IPlayableOptions) => {
            await app.playById(id);
        };
    }

}
