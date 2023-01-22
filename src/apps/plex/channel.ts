import createDebug from "debug";

import { PlexApp } from ".";
import { IPlayableOptions, IPlayerChannel } from "../../app";
import { PlexApi } from "./api";
import { IPlexOpts } from "./config";

const debug = createDebug("babbling:plex:channel");

export class PlexPlayerChannel implements IPlayerChannel<PlexApp> {
    private api: PlexApi;

    constructor(
        private readonly options: IPlexOpts,
    ) {
        this.api = new PlexApi(this.options.token, this.options.clientIdentifier);
    }

    public ownsUrl(url: string): boolean {
        return url.startsWith("plex");
    }

    public async createPlayable(url: string) {
        return async (app: PlexApp, opts: IPlayableOptions) => {
            debug("playing on plex: ", url);
            return app.playByUri(url, {
                // TODO language options?
                startTime: opts.resume === false ? 0 : undefined,
            });
        };
    }

    public async* queryRecommended() {
        // NOTE: HBO actually has a "recommended," but the other apps are returning
        // "continue watching" content here, so until we update the API to have that
        // as a distinct method, let's stay internally consistent
        const items = await this.api.getContinueWatching();
        for (const item of items) {
            yield {
                appName: "PlexApp",
                cover: item.thumb,
                playable: await this.createPlayable(item.uri),
                title: item.seriesTitle ?? item.title,
                url: item.uri,
            };
        }
    }

}
