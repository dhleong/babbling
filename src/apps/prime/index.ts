import _debug from "debug";
const debug = _debug("babbling:PrimeApp");

import request from "request-promise-native";

import { generateDeviceId } from "chakram-ts/dist/util";
import os from "os";

import { ICastSession, IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";

const APP_ID = "17608BC8";
const AUTH_NS = "urn:x-cast:com.amazon.primevideo.cast";

const DEFAULT_DOMAIN = "api.amazon.com";

export interface IPrimeOpts {
    // TODO
    cookies: string;
    deviceId?: string;
    marketplaceId?: string;
    refreshToken?: string;
    domain?: string;
}

export class PrimeApp extends BaseApp {

    private readonly deviceId: string;
    private readonly opts: IPrimeOpts;

    constructor(device: IDevice, options: IPrimeOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.opts = options;
        this.deviceId = options.deviceId || generateDeviceId(
            APP_ID,
            os.hostname(),
        );
    }

    public async play(titleId: string) {
        const session = await this.joinOrRunNamespace(AUTH_NS);
        const resp = await castRequest(session, this.message("AmIRegistered"));
        debug("registered=", resp);

        if (resp.error && resp.error.code === "NotRegistered") {
            await this.register(session);
        }

        debug("registered! ensureCastSession... ");
        const s = await this.ensureCastSession();
        return;

        debug("request playback:", titleId);
        s.send({
            autoplay: true,
            customData: {
                deviceId: this.deviceId,
                initialTracks: {},
            },
            media: {
                customData: {
                    videoMaterialType: "Feature", // TODO ?
                },

                contentId: titleId,
                contentType: "video/mp4",
                streamType: "BUFFERED",
            },
            sessionId: s.id,
            type: "LOAD",
        });

        let ms;
        do {
            ms = await Promise.race([
                awaitMessageOfType(s, "LOAD_FAILED"),
                awaitMessageOfType(s, "MEDIA_STATUS"),
            ]);
            debug(ms);

            if (ms.type === "LOAD_FAILED") {
                throw new Error(`Load failed: ${ms.detailedErrorCode}`);
            }

        } while (!ms.status.length);
        debug(ms.status[0].media);
    }

    private message(type: string, extra: any = {}) {
        return Object.assign({
            deviceId: this.deviceId,
            messageProtocolVersion: 1,
            type,
        }, extra);
    }

    private async register(session: ICastSession) {
        debug("register with id", this.deviceId);

        const preAuthorizedLinkCode =
            await this.generatePreAuthorizedLinkCode();

        await checkedRequest(session, this.message("Register", {
            // TODO load this from chakram
            marketplaceId: this.opts.marketplaceId,

            preAuthorizedLinkCode,
        }));

        // await checkedRequest(session, this.message("AmIRegistered"));
    }

    private async generatePreAuthorizedLinkCode() {
        debug(`generating pre-authorized link code...`);
        const response = await request.post({
            body: {
                auth_data: {
                    access_token: this.opts.refreshToken,
                },
                code_data: {
                    domain: "Device",

                    app_name: "defaultAppName",
                    app_version: "42",
                    device_model: "Pixel",
                    device_serial: this.deviceId,
                    device_type: "android",
                    os_version: "22",
                },
            },
            json: true,
            url: this.buildUrl("/auth/create/code"),
        });

        if (!response.code) {
            throw new Error(JSON.stringify(response));
        }

        debug(`generated pre-authorized link code: ${response.code}`);
        return response.code;
    }

    private buildUrl(path: string): string {
        const domain = this.opts.domain || DEFAULT_DOMAIN;
        return `https://${domain}/${path}`;
    }

}

async function castRequest(session: ICastSession, message: any) {
    const responseType = message.type + "Response";
    session.send(message);
    return awaitMessageOfType(session, responseType);
}

async function checkedRequest(session: ICastSession, message: any) {
    const resp = await castRequest(session, message);
    if (resp.error) {
        throw resp.error;
    }
    debug(" -> ", resp);
    return resp;
}
