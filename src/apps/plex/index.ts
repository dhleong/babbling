import _debug from "debug";

import { ChromecastDevice, MEDIA_NS } from "stratocaster";
import { ILoadRequest, IMedia } from "../../cast";

import { BaseApp } from "../base";
import { PlexApi } from "./api";
import { IPlexOpts } from "./config";

const debug = _debug("babbling:PlexApp");

const APP_ID = "9AC194DC";
// const APP_NS = "urn:x-cast:plex";

export class PlexApp extends BaseApp {
    private readonly api: PlexApi;

    constructor(device: ChromecastDevice, private readonly options: IPlexOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.api = new PlexApi(options.token, options.clientIdentifier);
    }

    public async playByUri(uri: string, opts: { language?: string, startTime?: number } = {}) {
        const url = new URL(uri);
        const [s, server] = await Promise.all([
            this.ensureCastSession(),
            this.api.getServerForUri(uri),
        ]);

        const serverURI = new URL(server.uri);

        const contentId = url.pathname; // strip leading slash
        const { playQueueID, selectedItemOffset } = await this.api.createPlayQueue(server, contentId);

        const offset = opts.startTime ?? selectedItemOffset;

        const media: IMedia = {
            contentId,
            contentType: "video",
            streamType: "BUFFERED",

            customData: {
                offset,
                directPlay: true,
                directStream: true,
                subtitleSize: 100,
                audioBoost: 100,
                containerKey: `/playQueues/${playQueueID}?own=1&window=200`,

                server: {
                    address: serverURI.hostname,
                    accessToken: server.accessToken,
                    port: serverURI.port != null ? parseInt(serverURI.port, 10) : undefined,
                    protocol: serverURI.protocol.replace(":", ""),
                    machineIdentifier: server.clientIdentifier,
                    myPlexSubscription: false, // TODO: Check user
                    isVerifiedHostname: true, // ?
                    transcoderVideo: true,
                    transcoderVideoRemuxOnly: false,
                    transcoderAudio: true,
                    user: { username: this.options.username ?? "dhleong" },
                    version: server.version,
                },
            },
        };

        const request: ILoadRequest = {
            autoplay: true,
            media,
            sessionId: s.destination ?? "",
            type: "LOAD",
        };

        if (offset !== undefined) {
            request.currentTime = offset;
        }

        // send LOAD request!
        const ms = await s.send(request as any);
        if (ms.type !== "MEDIA_STATUS") {
            throw new Error(`Load failed: ${ms}`);
        }

        debug("LOAD complete", (ms as any).status[0].media);
    }
}
