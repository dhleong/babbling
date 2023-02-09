import debug_ from "debug";

import AbortController from "abort-controller";
import {
    StratoChannel,
    ChromecastDevice,
    isJson,
    IReceiverStatus,
    RECEIVER_NS,
} from "stratocaster";

import { IMediaStatus, IMediaStatusMessage } from "../cast";
import { BaseApp, MEDIA_NS } from "./base";
import { mergeAsyncIterables } from "../async";

const debug = debug_("babbling:tracker");

/**
 * value of attachedMediaSessionId when we haven't yet been attached to
 * a session
 */
const NOT_ATTACHED = -1;

export interface IPlaybackTrackerEvents<TMedia> {
    getCurrentMedia?: () => TMedia | undefined;
    setCurrentMedia?: (media: TMedia | undefined) => void;

    onPlayerPaused?: (
        currentTimeSeconds: number,
        media?: TMedia,
    ) => Promise<void>;
}

/**
 * Utility for tracking playback events
 */
export class PlaybackTracker<TMedia = void> {
    /**
     * @internal
     * a timestamp from Date.now() if playing, else a negative number
     */
    private playbackStartedAt = -1;

    /**
     * @internal
     * the time in SECONDS at which we started playback
     */
    private playbackLastCurrentTime = -1;

    private attachedMediaSessionId = NOT_ATTACHED;
    private stopObserving: (() => void) | undefined;

    constructor(
        private app: BaseApp,
        private events: IPlaybackTrackerEvents<TMedia>,
    ) {}

    public async start() {
        debug("start tracking");

        const device = this.getDevice();

        const s: StratoChannel = await this.joinOrRunNamespace(MEDIA_NS);
        this.stopObserving = this.observeMessages([
            await device.channel(RECEIVER_NS),
            s,
        ]);
    }

    public stop() {
        debug("stop tracking");

        this.attachedMediaSessionId = NOT_ATTACHED;

        const { stopObserving } = this;
        this.stopObserving = undefined;
        if (stopObserving) {
            stopObserving();
        }
    }

    protected async handleClose() {
        debug(`handleClose(startedAt=${this.playbackStartedAt})`);

        if (this.playbackStartedAt <= 0) return;

        // NOTE: Date.now() is in millis; onPlayerPaused is in seconds
        const delta = (Date.now() - this.playbackStartedAt) / 1000;
        const currentTime = this.playbackLastCurrentTime + delta;
        const media = this.getCurrentMedia();

        // reset state to avoid dups
        this.playbackStartedAt = -1;
        this.playbackLastCurrentTime = -1;
        if (this.events.setCurrentMedia) {
            this.events.setCurrentMedia(undefined);
        }

        debug(`triggering onPaused(${currentTime}) from close event`);

        // trigger "paused"
        await this.onPlayerPaused(currentTime, media);
    }

    protected async handleMediaStatus(status: IMediaStatus) {
        if (this.attachedMediaSessionId === NOT_ATTACHED) {
            this.attachedMediaSessionId = status.mediaSessionId;
            debug("attached to media session", this.attachedMediaSessionId);
        }

        switch (status.playerState) {
            case "BUFFERING": // buffering should be the same as "paused"
            case "PAUSED":
                this.playbackStartedAt = -1;
                this.playbackLastCurrentTime = -1;
                await this.onPlayerPaused(
                    status.currentTime,
                    this.getCurrentMedia(),
                );
                break;

            case "PLAYING":
                this.playbackStartedAt = Date.now();
                this.playbackLastCurrentTime = status.currentTime;
                break;

            case "IDLE":
                if (this.attachedMediaSessionId === NOT_ATTACHED) {
                    this.attachedMediaSessionId = status.mediaSessionId;
                    debug(`attached to mediaSession #${status.mediaSessionId}`);
                } else if (
                    status.mediaSessionId !== this.attachedMediaSessionId
                ) {
                    // if a new mediaSession starts, we can go (and should)
                    // go ahead and hang up
                    debug(
                        `new mediaSession (${status.mediaSessionId} != ${this.attachedMediaSessionId})`,
                    );
                    await this.handleClose();
                    this.getDevice().close();
                }
                break;

            case "LOADING":
            // nop
        }
    }

    private onDeviceStatus = async (status: IReceiverStatus) => {
        if (!status.applications) {
            // no app info; ignore
            return;
        }

        for (const appInfo of status.applications) {
            if (appInfo.appId === this.app.appId) {
                // we're still running
                return;
            }
        }

        // if we get here, our app has been stopped; disconnect
        debug("App no longer running; shutting down");
        await this.handleClose();
        this.getDevice().close();
    };

    private onSessionMessage = async (m: any) => {
        switch (m.type) {
            case "CLOSE":
                await this.handleClose();
                break;

            case "MEDIA_STATUS": {
                const statusMessage = m as IMediaStatusMessage;
                if (!statusMessage.status.length) return;

                this.handleMediaStatus(statusMessage.status[0]);
                break;
            }
        }
    };

    /**
     * event helpers
     */

    private getCurrentMedia() {
        if (this.events.getCurrentMedia) {
            return this.events.getCurrentMedia();
        }
    }

    private async onPlayerPaused(currentTimeSeconds: number, media?: TMedia) {
        if (this.events.onPlayerPaused) {
            await this.events.onPlayerPaused(currentTimeSeconds, media);
        }
    }

    // NOTE: these methods use some hacks to reach into protected
    // fields and methods of the App instance, so we can be composed
    // into apps instead of forcing apps to subclass. This has a bad
    // smell, but since these fields are part of the App API it's
    // unlikely we will change them.

    private getDevice() {
        return (this.app as any).device as ChromecastDevice;
    }

    private async joinOrRunNamespace(ns: string): Promise<StratoChannel> {
        return this.getDevice().channel(ns);
    }

    private observeMessages(channels: StratoChannel[]) {
        const abort = new AbortController();

        (async () => {
            const merged = mergeAsyncIterables(
                channels.map((it) => it.receive({ signal: abort.signal })),
            );
            for await (const m of merged) {
                if (!isJson(m.data)) continue;

                if (m.data.type === "RECEIVER_STATUS") {
                    const status = m.data.status as unknown as IReceiverStatus;
                    await this.onDeviceStatus(status);
                } else {
                    await this.onSessionMessage(m.data);
                }
            }

            debug("observeMessages exited");
        })();

        return () => {
            debug("Aborting observeMessages");
            abort.abort();
        };
    }
}
