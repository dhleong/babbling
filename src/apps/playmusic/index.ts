import { IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";

import { IPlayMusicOptions } from "./config";

const APP_ID = "2872939A";
const MUSIC_NS = "urn:x-cast:com.google.android.music.cloudqueue";

export class PlayMusicApp extends BaseApp {

    constructor(device: IDevice, options: IPlayMusicOptions = {}) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });
    }

    public async play() {
        await this.ensurePlaySession();

        const playOnToken = ""; // FIXME ??

        const s = await this.ensureCastSession();
        s.send({
            autoplay: true,
            customData: {
                contentType: "application/x-cloud-queue",
                httpHeaders: {
                    Authorization: "playon=" + playOnToken,
                },
                itemId: "", // some sort of UUID?
                queueBaseUrl: "https://www.googleapis.com/musicqueue/v1.0/",
            },
            media: {
                contentId: "", // TODO ?
                contentType: "audio/mpeg",
                metadata: {
                    albumArtist: "", // TODO
                    albumName: "", // TODO
                    artist: "", // TODO
                    images: [
                        {
                            url: "", // TODO
                        },
                    ],
                    metadataType: 3,
                    title: "", // TODO
                    type: 3,
                },
                streamType: "BUFFERED",
            },
            type: "LOAD",
        });
    }

    private async ensurePlaySession() {
        const s = await this.joinOrRunNamespace(MUSIC_NS);
        const cloudQueueAppContext = ""; // TODO
        s.send({
            cloudQueueAppContext,
            type: "joinSessionExtras",
        });

        return s;
    }

}
