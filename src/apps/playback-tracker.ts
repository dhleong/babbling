import debug_ from "debug";
const debug = debug_("babbling:tracker");

import { ICastSession, IDevice, IMediaStatus, IMediaStatusMessage, IReceiverStatusMessage } from "nodecastor";

import { BaseApp, MEDIA_NS } from "./base";

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
    private playbackStartedAt: number = -1;

    /**
     * @internal
     * the time in SECONDS at which we started playback
     */
    private playbackLastCurrentTime: number = -1;

    private attachedMediaSessionId = NOT_ATTACHED;

    private session: ICastSession | undefined;

    constructor(
        private app: BaseApp,
        private events: IPlaybackTrackerEvents<TMedia>,
    ) {
    }

    public async start() {
        debug("start tracking");

        const device = this.getDevice();
        device.on("status", this.onDeviceStatus);

        const s: ICastSession = await this.joinOrRunNamespace(MEDIA_NS);
        this.session = s;
        s.on("message", this.onSessionMessage);
    }

    public stop() {
        debug("stop tracking");

        this.attachedMediaSessionId = NOT_ATTACHED;
        this.getDevice().removeListener("status", this.onDeviceStatus);
        const s = this.session;
        this.session = undefined;
        if (s) {
            s.removeListener("message", this.onSessionMessage);
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
        if (
            this.attachedMediaSessionId === NOT_ATTACHED
        ) {
            this.attachedMediaSessionId = status.mediaSessionId;
            debug("attached to media session", this.attachedMediaSessionId);
        }

        switch (status.playerState) {
        case "BUFFERING": // buffering should be the same as "paused"
        case "PAUSED":
            this.playbackStartedAt = -1;
            this.playbackLastCurrentTime = -1;
            await this.onPlayerPaused(status.currentTime, this.getCurrentMedia());
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
                this.getDevice().stop();
            }
            break;
        }
    }

    private onDeviceStatus = async (status: IReceiverStatusMessage) => {
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
        await this.handleClose();
        this.getDevice().stop();
        debug("App no longer running; shutting down");
    }

    private onSessionMessage = async (m: any) => {
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
    }

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
        return (this.app as any).device as IDevice;
    }

    private async joinOrRunNamespace(ns: string): Promise<ICastSession> {
        return (this.app as any).joinOrRunNamespace(ns);
    }

}
