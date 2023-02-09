import _debug from "debug";

import { ChromecastDevice, MEDIA_NS } from "stratocaster";
import { ILoadRequest, IMedia } from "../../cast";

import { BaseApp } from "../base";
import { PlexApi } from "./api";
import { PlexPlayerChannel } from "./channel";
import { IPlexOpts } from "./config";
import { extractMediaKeyFromUri } from "./model";

const debug = _debug("babbling:plex");

const APP_ID = "9AC194DC";

export interface IPlaybackOptions {
    language?: string;
    startTime?: number;
}

export class PlexApp extends BaseApp {
    private readonly api: PlexApi;

    public static createPlayerChannel(options: IPlexOpts) {
        return new PlexPlayerChannel(options);
    }

    constructor(device: ChromecastDevice, options: IPlexOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.api = new PlexApi(options.token, options.clientIdentifier);
    }

    public async resumeByUri(uri: string, opts: IPlaybackOptions = {}) {
        try {
            // Attempt to resolve the "actual" item to play
            debug("Resolving onDeck for", uri, "...");
            const onDeck = await this.api.resolveOnDeckForUri(uri);
            debug("Resolved onDeck:", uri, " -> ", onDeck);
            return await this.playByUri(onDeck.uri, opts);
        } catch (e) {
            // Fallback to whatever was literally provided
            debug("Error resolving onDeck for", uri, e);
            return this.playByUri(uri, opts);
        }
    }

    public async playByUri(uri: string, opts: IPlaybackOptions = {}) {
        const [s, server, user] = await Promise.all([
            this.ensureCastSession(),
            this.api.getServerForUri(uri),
            this.api.getUser(),
        ]);

        const serverURI = new URL(server.uri);

        const contentId = extractMediaKeyFromUri(uri);
        const { playQueueID, selectedItemOffset } =
            await this.api.createPlayQueue(server, contentId);

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
                    port:
                        serverURI.port != null
                            ? parseInt(serverURI.port, 10)
                            : undefined,
                    protocol: serverURI.protocol.replace(":", ""),
                    machineIdentifier: server.clientIdentifier,
                    myPlexSubscription: user.subscription.active,
                    isVerifiedHostname: true, // ?
                    transcoderVideo: true,
                    transcoderVideoRemuxOnly: false,
                    transcoderAudio: true,
                    user: { username: user.username },
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
