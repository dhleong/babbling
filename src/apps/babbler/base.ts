import debug_ from "debug";
const debug = debug_("babbling:babbler");

import { ICastSession, IDevice, IMediaStatusMessage } from "nodecastor";
import { BaseApp, MEDIA_NS } from "../base";
import { PlaybackTracker } from "../playback-tracker";
import { awaitMessageOfType } from "../util";
import { BabblerDaemon, RPC } from "./daemon";
import {
    IChromecastMetadata, IMediaMetadata, ITvShowChromecastMetadata,
    MetadataType,
    SenderCapabilities,
} from "./model";

const BABBLER_SESSION_NS = "urn:x-cast:com.github.dhleong.babbler";

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

function handleErrors<T>(promise: Promise<T>) {
    return promise.catch(e => {
        throw e;
    });
}

function formatMetadata(metadata: IMediaMetadata) {
    const formatted: IChromecastMetadata = {
        metadataType: MetadataType.Generic,
        title: metadata.title,
    };

    if (metadata.images && metadata.images.length) {
        formatted.images = metadata.images.map(imageUrl => ({
            url: imageUrl,
        }));
    }

    if (metadata.seriesTitle) {
        formatted.metadataType = MetadataType.TvShow;
        (formatted as ITvShowChromecastMetadata).seriesTitle = metadata.seriesTitle;
    }

    return formatted;
}

export interface IQueueItem<TMedia> {
    id: string;
    licenseUrl?: string;
    media?: TMedia;
    metadata: IMediaMetadata;
    currentTime?: number;
}

export interface IPlayableInfo {
    contentId: string;
    contentUrl: string;
    customData?: {
        license?: {
            ipc?: boolean;
            url?: string;
        };
    };
    metadata?: IMediaMetadata;
}

/**
 * Base class for apps that use Babbler for playback
 */
export class BabblerBaseApp<TMedia = {}> extends BaseApp {

    protected tracker: PlaybackTracker<TMedia> | undefined;

    /** @internal */
    private isDaemon: boolean = false;

    private currentMedia: TMedia | undefined;

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

        const tracker = new PlaybackTracker<TMedia>(this, {
            getCurrentMedia: () => this.currentMedia,
            setCurrentMedia: media => { this.currentMedia = media; },

            onPlayerPaused: this.onPlayerPaused.bind(this),
        });
        this.tracker = tracker;
        await tracker.start();
    }

    /** @internal */
    public async rpc(call: RPC) {
        const [ m, args ] = call;
        switch (m) {
        case "loadMedia":
            if (args.length < 1) throw new Error("Invalid args to loadMedia");

            const [ options ] = args;
            await this.loadMedia(options);
        }
    }

    public async start() {
        await super.start();

        const s = await this.joinOrRunNamespace(BABBLER_SESSION_NS);
        s.on("message", m => {
            switch (m.type) {
            case "INFO":
                handleErrors(this.handleInfoRequest(s, m));
                break;

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

    protected async loadMedia(item: IQueueItem<TMedia>) {
        if (!this.isDaemon && this.babblerOpts.daemonOptions) {
            debug("spawning daemon");
            return BabblerDaemon.spawn({
                appName: this.constructor.name,
                appOptions: this.babblerOpts.daemonOptions,
                deviceName: this.device.friendlyName,

                rpc: [
                    "loadMedia",
                    [item],
                ],
            });
        }

        const s = await this.ensureCastSession();

        this.currentMedia = item.media;

        let metadata: any;
        if (item.metadata) {
            metadata = formatMetadata(item.metadata);
        }

        s.send({
            autoplay: true,
            currentTime: item.currentTime,
            customData: this.createCustomData(item),
            media: {
                contentId: item.id,
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

    protected async loadInfoFor(
        contentId: string,
    ): Promise<IPlayableInfo> {
        throw new Error("loadInfoFor not implemented");
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        throw new Error("performLicenseRequest not implemented");
    }

    protected async loadQueueBefore(
        contentId: string,
        media?: TMedia,
    ): Promise<Array<IQueueItem<TMedia>>> {
        throw new Error("loadQueueBefore not implemented");
    }

    protected async loadQueueAfter(
        contentId: string,
        media?: TMedia,
    ): Promise<Array<IQueueItem<TMedia>>> {
        throw new Error("loadQueueAfter not implemented");
    }

    private async handleInfoRequest(s: ICastSession, message: any) {
        const { contentId, requestId } = message;

        debug("incoming info request #", requestId);
        const response = await this.loadInfoFor(contentId);

        s.send({
            response,
            responseTo: requestId,
            type: "INFO_RESPONSE",
        });
    }

    private async handleLicenseRequest(s: ICastSession, message: any) {
        const { base64, url, requestId } = message;
        const buffer = Buffer.from(base64, "base64");

        debug("incoming perform license request #", requestId);
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
        const items = mode === "before"
            ? await this.loadQueueBefore(contentId, this.currentMedia)
            : await this.loadQueueAfter(contentId, this.currentMedia);

        s.send({
            response: items.map(item => ({
                contentId: item.id,
                currentTime: item.currentTime,
                customData: this.createCustomData(item),
                metadata: formatMetadata(item.metadata),
            })),
            responseTo: requestId,
            type: "QUEUE_RESPONSE",
        });
    }

    private createCustomData(queueItem: IQueueItem<any>): any {
        return {
            capabilities: this.babblerOpts.capabilities,
            license: {
                ipc: this.babblerOpts.useLicenseIpc,
                url: queueItem.licenseUrl,
            },
        };
    }

}
