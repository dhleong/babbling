import debug_ from "debug";
const debug = debug_("babbling:babbler");

import { ICastSession, IDevice, IMediaStatus, IMediaStatusMessage } from "nodecastor";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";
import { BabblerDaemon, RPC } from "./daemon";

const BABBLER_SESSION_NS = "urn:x-cast:com.github.dhleong.babbler";

export interface IBabblerOpts {
    appId: string;
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

/**
 * Base class for apps that use Babbler for playback
 */
export class BabblerBaseApp extends BaseApp {

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

    constructor(
        device: IDevice,
        private babblerOpts: IBabblerOpts,
    ) {
        super(device, Object.assign({
            sessionNs: MEDIA_NS,
        }, babblerOpts));
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

        if (this.babblerOpts.useLicenseIpc) {
            const s = await this.joinOrRunNamespace(BABBLER_SESSION_NS);
            s.on("message", m => {
                if (m.type === "LICENSE") {
                    this.handleLicenseRequest(s, m).catch(e => {
                        throw e;
                    });
                }
            });
        }
    }

    protected async loadUrl(
        url: string,
        opts: {
            licenseUrl?: string,
            metadata?: IMediaMetadata,
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

        let metadata: any;
        if (opts.metadata) {
            metadata = Object.assign({
                metadataType: 0,
                title: opts.metadata.title,
                type: 0,
            });

            if (opts.metadata.images && opts.metadata.images.length) {

                metadata.images = opts.metadata.images.map(imageUrl => ({
                    url: imageUrl,
                }));
            }
        }

        s.send({
            autoplay: true,
            customData: {
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

        let ms;
        do {
            ms = await awaitMessageOfType(s, "MEDIA_STATUS");
            debug(ms);
        } while (!ms.status.length);
    }

    /**
     * Called if we're running in daemon mode and the media
     * has been paused, or the player stopped
     */
    protected async onPlayerPaused(currentTimeSeconds: number) {
        // nop
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        throw new Error("performLicenseRequest not implemented");
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

    private async handleClose() {
        if (this.playbackStartedAt <= 0) return;

        // NOTE: Date.now() is in millis; onPlayerPaused is in seconds
        const delta = (Date.now() - this.playbackStartedAt) / 1000;
        const currentTime = this.playbackLastCurrentTime + delta;

        // reset state to avoid dups
        this.playbackStartedAt = -1;
        this.playbackLastCurrentTime = -1;

        debug(`triggering onPaused(${currentTime}) from close event`);

        // trigger "paused"
        await this.onPlayerPaused(currentTime);
    }

    private async handleMediaStatus(status: IMediaStatus) {
        switch (status.playerState) {
        case "PAUSED":
            this.playbackStartedAt = -1;
            this.playbackLastCurrentTime = -1;
            await this.onPlayerPaused(status.currentTime);
            break;

        case "PLAYING":
            this.playbackStartedAt = Date.now();
            this.playbackLastCurrentTime = status.currentTime;
            break;
        }
    }
}
