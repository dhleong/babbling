import _debug from "debug";

import { ChromecastDevice, MEDIA_NS } from "stratocaster";
import { ILoadRequest, IMedia } from "../../cast";

import { BaseApp } from "../base";
import { IPlexOpts } from "./config";

const debug = _debug("babbling:PlexApp");

const APP_ID = "9AC194DC";
// const APP_NS = "urn:x-cast:plex";

export class PlexApp extends BaseApp {
    constructor(device: ChromecastDevice, private readonly options: IPlexOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });
    }

    public async play(entityId: string, opts: { language?: string, startTime?: number } = {}) {
        const [s] = await Promise.all([
            this.ensureCastSession(),
        ]);

        const media: IMedia = {
            contentId: entityId,
            contentType: "video",
            streamType: "BUFFERED",

            customData: {
                offset: opts.startTime,
                server: {
                    machineIdentifier: this.options.clientIdentifier,
                    accessToken: this.options.token,
                    user: { username: this.options.username },
                },
            },
        };

        const request: ILoadRequest = {
            autoplay: true,
            media,
            sessionId: s.destination ?? "",
            type: "LOAD",
        };

        if (opts.startTime !== undefined) {
            request.currentTime = opts.startTime;
        }

        // send LOAD request!
        const ms = await s.send(request as any);
        if (ms.type !== "MEDIA_STATUS") {
            throw new Error(`Load failed: ${ms}`);
        }

        debug("LOAD complete", (ms as any).status[0].media);
    }
}
