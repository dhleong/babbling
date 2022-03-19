import _debug from "debug";

import { ChromecastDevice, StratoChannel } from "stratocaster";

import { MEDIA_NS } from "./apps/base";

const debug = _debug("babbling:controls");

export class MediaControls {
    public static async open(device: ChromecastDevice) {
        const status = await device.getStatus();

        if (!status.applications || !status.applications.length) {
            throw new Error("No running application");
        }

        try {
            const app = await device.app(status.applications[0].appId);
            const session = await app.channel(MEDIA_NS);

            // request media status so we can get the mediaSession
            const response = await session.send({ type: "GET_STATUS" });
            const mediaStatus = response as any;
            debug("GOT media status", mediaStatus);

            return new MediaControls(session, mediaStatus.status[0].mediaSessionId);
        } catch (e: any) {
            if (e.message && e.message.includes("namespace")) {
                throw new Error("No media app running");
            }

            throw e;
        }
    }

    constructor(
        private session: StratoChannel,
        private mediaSessionId: number,
    ) {}

    public pause() { this.sendSimple("PAUSE"); }
    public play() { this.sendSimple("PLAY"); }
    public stop() { this.sendSimple("STOP"); }

    public playAgain() { this.sendSimple("PLAY_AGAIN"); }
    public skipAd() { this.sendSimple("SKIP_AD"); }

    public nextQueueItem() { this.sendSimple("QUEUE_NEXT"); }
    public prevQueueItem() { this.sendSimple("QUEUE_PREV"); }

    public seekRelative(relativeSeconds: number) {
        this.sendData({
            relativeTime: relativeSeconds,
            type: "SEEK",
        });
    }
    public seekTo(videoTimestampSeconds: number) {
        this.sendData({
            currentTime: videoTimestampSeconds,
            type: "SEEK",
        });
    }

    public setMuted(isMuted: boolean) {
        this.sendData({
            type: "SET_VOLUME",
            volume: {
                muted: isMuted,
            },
        });
    }

    /**
     * @param level In range [0, 1]
     */
    public setVolume(level: number) {
        this.sendData({
            type: "SET_VOLUME",
            volume: {
                level,
            },
        });
    }

    private sendSimple(type: string) {
        this.sendData({
            type,
        });
    }

    private sendData(data: any) {
        const filled = {
            ...data,
            mediaSessionId: this.mediaSessionId,
        };
        debug("SEND", filled);
        this.session.send(filled);
    }
}
