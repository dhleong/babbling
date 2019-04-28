import { IDevice } from "nodecastor";
import { MEDIA_NS } from "./apps/base";

export class MediaControls {
    constructor(
        private device: IDevice,
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
        this.device.channel.send({
            data,
            namespace: MEDIA_NS,
        });
    }
}
