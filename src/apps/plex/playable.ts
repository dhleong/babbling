import createDebug from "debug";

import type { PlexApp } from ".";
import type { IPlayable, IPlayableOptions } from "../../app";

const debug = createDebug("babbling:plex:playable");

export function createPlayableForUri(uri: string): IPlayable<PlexApp> {
    return async (app: PlexApp, opts: IPlayableOptions) => {
        debug("resuming on plex: ", uri);
        return app.resumeByUri(uri, {
            // TODO language options?
            startTime: opts.resume === false ? 0 : undefined,
        });
    };
}
