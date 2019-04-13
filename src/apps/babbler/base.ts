import debug_ from "debug";
const debug = debug_("babbling:babbler");

import { ICastSession, IDevice, IMediaStatus, IMediaStatusMessage } from "nodecastor";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";
import { BabblerDaemon, RPC } from "./daemon";
import { SenderCapabilities } from "./model";

const BABBLER_SESSION_NS = "urn:x-cast:com.github.dhleong.babbler";

/**
 * value of attachedMediaSessionId when we haven't yet been attached to
 * a session
 */
const NOT_ATTACHED = -1;

export interface IBabblerOpts {
    appId: string;
    capabilities: SenderCapabilities;
    useLicenseIpc: boolean;

    /**
     * options to pass to constructor for use in Daemon.  If passed,
     * `loadUrl` will be called in a Daemon, and submitPositionUpdate
     * will be called periodically
     */
    daemonOptions?: any;
}

export interface IMediaMetadata {
    title: string;
    images?: string[];
}

function handleErrors<T>(promise: Promise<T>) {
    return promise.catch(e => {
        throw e;
    });
}

function formatMetadata(metadata: IMediaMetadata) {
    const formatted: any = Object.assign({
        metadataType: 0,
        title: metadata.title,
        type: 0,
    });

    if (metadata.images && metadata.images.length) {

        formatted.images = metadata.images.map(imageUrl => ({
            url: imageUrl,
        }));
    }

    return formatted;
}

export interface IQueueItem {
    url: string;
    metadata: IMediaMetadata;
}

/**
 * Base class for apps that use Babbler for playback
 */
export class BabblerBaseApp<TMedia = {}> extends BaseApp {

    /** @internal */
    private isDaemon: boolean = false;

    /**
     * @internal
     * a timestamp from Date.now() if playing, else a negative number
     */
    private playbackStartedAt: number = -1;

    /**
     * @internal
     * the time in SECONDS at which we started playback
     */
    private playbackLastCurrentTime: number = -1;

    private currentMedia: TMedia | undefined;
    private attachedMediaSessionId = NOT_ATTACHED;

    constructor(
        device: IDevice,
        private babblerOpts: IBabblerOpts,
    ) {
        super(device, Object.assign({
            sessionNs: MEDIA_NS,
        }, babblerOpts));

        if (!this.appId) {
            throw new Error("No babbler app ID configured");
        }
    }

    /** @internal */
    public async runDaemon() {
        this.isDaemon = true;

        this.device.on("status", async status => {
            if (!status.applications) {
                // no app info; ignore
                return;
            }

            for (const appInfo of status.applications) {
                if (appInfo.appId === this.appId) {
                    // we're still running
                    return;
                }
            }

            // if we get here, our app has been stopped; disconnect
            await this.handleClose();
            this.device.stop();
            debug("App no longer running; shutting down daemon");
        });

        const s = await this.ensureCastSession();
        s.on("message", async m => {
            switch (m.type) {
            case "CLOSE":
                await this.handleClose();
                break;

            case "MEDIA_STATUS":
                const statusMessage = m as IMediaStatusMessage;
                if (!statusMessage.status.length) return;

                this.handleMediaStatus(statusMessage.status[0]);
                break;
            }
        });
    }

    /** @internal */
    public async rpc(call: RPC) {
        const [ m, args ] = call;
        switch (m) {
        case "loadUrl":
            if (args.length < 1) throw new Error("Invalid args to loadUrl");

            const [ url, ...options ] = args;
            await this.loadUrl(url, ...options);
        }
    }

    public async start() {
        await super.start();

        const s = await this.joinOrRunNamespace(BABBLER_SESSION_NS);
        s.on("message", m => {
            switch (m.type) {
            case "LICENSE":
                if (this.babblerOpts.useLicenseIpc) {
                    handleErrors(this.handleLicenseRequest(s, m));
                }
                break;

            case "QUEUE":
                handleErrors(this.handleQueueRequest(s, m));
                break;
            }
        });
    }

    protected async loadUrl(
        url: string,
        opts: {
            licenseUrl?: string,
            metadata?: IMediaMetadata,
            media?: TMedia,
            startTime?: number,
        } = {},
    ) {
        if (!this.isDaemon && this.babblerOpts.daemonOptions) {
            debug("spawning daemon");
            return BabblerDaemon.spawn({
                appName: this.constructor.name,
                appOptions: this.babblerOpts.daemonOptions,
                deviceName: this.device.friendlyName,

                rpc: [
                    "loadUrl",
                    [url, opts],
                ],
            });
        }

        const s = await this.ensureCastSession();

        this.currentMedia = opts.media;

        let metadata: any;
        if (opts.metadata) {
            metadata = formatMetadata(opts.metadata);
        }

        s.send({
            autoplay: true,
            currentTime: opts.startTime,
            customData: {
                capabilities: this.babblerOpts.capabilities,
                license: {
                    ipc: this.babblerOpts.useLicenseIpc,
                    url: opts.licenseUrl,
                },
            },
            media: {
                contentId: url,
                contentType: "video/mp4",
                metadata,
                streamType: "BUFFERED",
            },
            sessionId: s.id,
            type: "LOAD",
        });

        let ms: IMediaStatusMessage;
        do {
            ms = await awaitMessageOfType(s, "MEDIA_STATUS");
            debug(ms);
        } while (!ms.status.length);

        if (
            ms.status.length
            && this.attachedMediaSessionId === NOT_ATTACHED
        ) {
            this.attachedMediaSessionId = ms.status[0].mediaSessionId;
            debug("attached to media session", this.attachedMediaSessionId);
        }
    }

    /**
     * Called if we're running in daemon mode and the media
     * has been paused, or the player stopped
     */
    protected async onFetchQueue(
        mode: "before" | "after",
        itemContentId: string,
    ) {
        return [];
    }

    /**
     * Called if we're running in daemon mode and the media
     * has been paused, or the player stopped
     */
    protected async onPlayerPaused(currentTimeSeconds: number, media: TMedia | undefined) {
        // nop
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        throw new Error("performLicenseRequest not implemented");
    }

    protected async performQueueRequest(
        mode: string,
        contentId: string,
    ): Promise<IQueueItem[]> {
        throw new Error("performQueueRequest not implemented");
    }

    private async handleLicenseRequest(s: ICastSession, message: any) {
        const { base64, url, requestId } = message;
        const buffer = Buffer.from(base64, "base64");

        debug("incoming perform license request");
        const response = await this.performLicenseRequest(buffer, url);

        s.send({
            response: response.toString("base64"),
            responseTo: requestId,
            type: "LICENSE_RESPONSE",
        });
    }

    private async handleQueueRequest(
        s: ICastSession,
        message: any,
    ) {
        const { contentId, mode, requestId } = message;

        debug("incoming queue request");
        const items = await this.performQueueRequest(mode, contentId);

        s.send({
            response: items.map(item => ({
                contentId: item.url,
                metadata: formatMetadata(item.metadata),
            })),
            responseTo: requestId,
            type: "QUEUE_RESPONSE",
        });
    }

    private async handleClose() {
        if (this.playbackStartedAt <= 0) return;

        // NOTE: Date.now() is in millis; onPlayerPaused is in seconds
        const delta = (Date.now() - this.playbackStartedAt) / 1000;
        const currentTime = this.playbackLastCurrentTime + delta;
        const media = this.currentMedia;

        // reset state to avoid dups
        this.playbackStartedAt = -1;
        this.playbackLastCurrentTime = -1;
        this.currentMedia = undefined;

        debug(`triggering onPaused(${currentTime}) from close event`);

        // trigger "paused"
        await this.onPlayerPaused(currentTime, media);
    }

    private async handleMediaStatus(status: IMediaStatus) {
        switch (status.playerState) {
        case "PAUSED":
            this.playbackStartedAt = -1;
            this.playbackLastCurrentTime = -1;
            await this.onPlayerPaused(status.currentTime, this.currentMedia);
            break;

        case "PLAYING":
            this.playbackStartedAt = Date.now();
            this.playbackLastCurrentTime = status.currentTime;
            break;

        case "IDLE":
            if (this.attachedMediaSessionId === NOT_ATTACHED) {
                this.attachedMediaSessionId = status.mediaSessionId;
                debug(`attached to mediaSession #${status.mediaSessionId}`);
            } else if (status.mediaSessionId !== this.attachedMediaSessionId) {
                // if a new mediaSession starts, we can go (and should)
                // go ahead and hang up
                debug(`new mediaSession (${status.mediaSessionId} != ${this.attachedMediaSessionId})`);
                await this.handleClose();
                this.device.stop();
            }
            break;
        }
    }
}
