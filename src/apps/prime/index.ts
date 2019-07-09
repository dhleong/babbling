import _debug from "debug";
const debug = _debug("PrimeApp");

import { generateDeviceId } from "chakram-ts/dist/util";
import os from "os";

import { ICastSession, IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";

const APP_ID = "17608BC8";
const AUTH_NS = "urn:x-cast:com.amazon.primevideo.cast";

export interface IPrimeOpts {
    // TODO
    cookies: string;
    deviceId?: string;
}

export class PrimeApp extends BaseApp {

    private readonly deviceId: string;

    constructor(device: IDevice, options: IPrimeOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.deviceId = options.deviceId || generateDeviceId(
            APP_ID,
            os.hostname(),
        );
    }

    public async play(titleId: string) {
        const session = await this.joinOrRunNamespace(AUTH_NS);
        const resp = await request(session, this.message("AmIRegistered"));
        debug("registered=", resp);

        if (resp.error && resp.error.code === "NotRegistered") {
            await this.register(session);
        }

        const s = await this.ensureCastSession();
        s.send({
            autoplay: true,
            customData: {
                videoMaterialType: "Feature", // TODO ?
            },
            media: {
                contentId: titleId,
                contentType: "video/mp4",
                streamType: "BUFFERED",
            },
            sessionId: s.id,
            type: "LOAD",
        });

    }

    private message(type: string, extra: any = {}) {
        return Object.assign({
            deviceId: this.deviceId,
            type,
        }, extra);
    }

    private async register(session: ICastSession) {
        debug("register with id", this.deviceId);
        const resp = await request(session, this.message("Register", {
            // TODO load this from chakram?
            marketplaceId: "ATVPDKIKX0DER",

            // TODO how do we get this?
            preAuthorizedLinkCode: undefined,
        }));
        debug(" -> ", resp);

        if (resp.error) {
            throw resp.error;
        }
    }

}

async function request(session: ICastSession, message: any) {
    const responseType = message.type + "Response";
    session.send(message);
    return awaitMessageOfType(session, responseType);
}
