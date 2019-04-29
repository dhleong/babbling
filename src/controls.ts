import _debug from "debug";
const debug = _debug("babbling:controls");

import { MEDIA_NS } from "./apps/base";
import { awaitMessageOfType, promise } from "./apps/util";
import { ICastSession, IDevice } from "./cast";

export class MediaControls {
    public static async open(device: IDevice) {
        const status = await promise(device, device.status);

        if (!status.applications || !status.applications.length) {
            throw new Error("No running application");
        }

        try {
            const app = await promise(device, device.application, status.applications[0].appId);
            const session = await promise(app, app.join, MEDIA_NS);

            // request media status so we can get the mediaSession
            session.send({ type: "GET_STATUS" });

            const mediaStatus = await awaitMessageOfType(session, "MEDIA_STATUS");
            debug("GOT media status", mediaStatus);

            return new MediaControls(session, mediaStatus.status[0].mediaSessionId);
        } catch (e) {
            if (e.message && e.message.includes("namespace")) {
                throw new Error("No media app running");
            }

            throw e;
        }
    }

    constructor(
        private session: ICastSession,
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
        const filled = Object.assign({
            mediaSessionId: this.mediaSessionId,
        }, data);
        debug("SEND", filled);
        this.session.send(filled);
    }
}
