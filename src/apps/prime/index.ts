import _debug from "debug";
const debug = _debug("babbling:PrimeApp");

import crypto from "crypto";
import os from "os";
import { gzip } from "zlib";

import request from "request-promise-native";
import generateRandomUUID from "uuid/v4";

import { generateDeviceId } from "chakram-ts/dist/util";

import { ICastSession, IDevice } from "../../cast";
import { BaseApp, MEDIA_NS } from "../base";
import { awaitMessageOfType } from "../util";

const APP_ID = "17608BC8";
const AUTH_NS = "urn:x-cast:com.amazon.primevideo.cast";

const DEFAULT_API_DOMAIN = "api.amazon.com";

const APP_NAME = "com.amazon.avod.thirdpartyclient";
const APP_VERSION = "253188041";

export interface IPrimeOpts {
    // TODO
    cookies: string;
    deviceId?: string;
    marketplaceId?: string;
    refreshToken?: string;
    apiDomain?: string;
}

export class PrimeApp extends BaseApp {

    private readonly deviceId: string;
    private readonly opts: IPrimeOpts;

    private readonly language = "en-US";

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
        return;
        const s = await this.ensureCastSession();

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

    public async generateFrcCookies() {
        const cookies = JSON.stringify({
            ApplicationName: APP_NAME,
            ApplicationVersion: APP_VERSION,
            DeviceLanguage: this.language,
            DeviceName: "ro.hardware/google/pixel",
            DeviceOSVersion: "google/bullhead/bullhead:6.0.1/MTC20F/3031278:user/release-key",
            ScreenHeightPixels: "1920",
            ScreenWidthPixels: "1280",
            TimeZone: "-04:00",
        });

        // gzip
        const zipped: Buffer = await new Promise((resolve, reject) => {
            gzip(cookies, {}, (e, result) => {
                if (e) reject(e);
                else resolve(result);
            });
        });

        // Cipher instance = Cipher.getInstance("AES/CBC/PKCS5Padding");
        // instance.init(1, b(str2, "AES/CBC/PKCS7Padding"));
        const key = this.createSaltedKey("AES/CBC/PKCS7Padding");
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);

        // toByteArray = instance.doFinal(toByteArray);
        // byte[] iv = instance.getIV();
        cipher.update(zipped);
        const ciphered = cipher.final();

        // Mac instance2 = Mac.getInstance("HmacSHA256");
        // instance2.init(b(str2, "HmacSHA256"));
        // instance2.update(iv);
        // instance2.update(toByteArray);
        // byte[] doFinal = instance2.doFinal();
        const hmac = crypto.createHmac("sha256", this.createSaltedKey("HmacSHA256"));
        hmac.update(iv);
        hmac.update(ciphered);
        const hmacd = hmac.digest();

        // byte[] bArr = new byte[(toByteArray.length + 25)];
        // bArr[0] = (byte) 0;
        // System.arraycopy(doFinal, 0, bArr, 1, 8);
        // System.arraycopy(iv, 0, bArr, 9, 16);
        // System.arraycopy(toByteArray, 0, bArr, 25, toByteArray.length);
        const toBase64Encode = Buffer.concat([
            Buffer.of(0),
            hmacd.slice(0, 8),
            iv,
            ciphered,
        ]);

        // return Base64.encodeToString(bArr, 2);
        return toBase64Encode.toString("base64");
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

        // await this.applySettings(session);
    }

    // private async applySettings(session: ICastSession) {
    //     await checkedRequest(session, this.message("ApplySettings", {
    //         settings: {
    //             autoplayNextEpisode: true,
    //             locale: this.language,
    //         },
    //     }));
    // }

    private async generatePreAuthorizedLinkCode() {
        debug(`generating pre-authorized link code...`);
        const body: any = {
            auth_data: {
                access_token: this.opts.refreshToken,
            },
            code_data: {
                domain: "Device",

                app_name: APP_NAME,
                app_version: APP_VERSION,
                device_model: "pixel",
                device_serial: this.deviceId,
                device_type: "android",
                os_version: "22",
            },
            scopes: ["aiv:full"],
        };

        const frc = await this.generateFrcCookies();
        if (frc !== null) {
            body.user_context_map = {
                frc,
            };
        }

        const response = await request.post({
            body,
            headers: {
                "x-amzn-identity-auth-domain": this.apiDomain(),
                "x-amzn-requestid": generateRandomUUID(),
            },
            json: true,
            url: this.buildUrl("/auth/create/code"),
        });

        if (!response.code) {
            throw new Error(JSON.stringify(response));
        }

        // TODO cache for response.expires_in seconds?
        debug(`generated pre-authorized link code: ${response.code}`);
        return response.code;
    }

    private buildUrl(path: string): string {
        const domain = this.apiDomain();
        return `https://${domain}/${path}`;
    }

    private apiDomain(): string {
        return this.opts.apiDomain || DEFAULT_API_DOMAIN;
    }

    private createSaltedKey(salt: crypto.BinaryLike) {
        // return new SecretKeySpec(
        //      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1")
        //          .generateSecret(
        //              new PBEKeySpec(
        //                  str.toCharArray(), str2.getBytes("UTF-8"), 1000, 128
        //              )
        //          ).getEncoded(),
        //          "AES"
        //      );
        return crypto.pbkdf2Sync(
            this.deviceId,
            salt,
            1000, // iterations
            16, // key length (/ 8, apparently)
            "SHA1", // hash
        );
    }

}

async function castRequest(session: ICastSession, message: any) {
    const responseType = message.type + "Response";
    session.send(message);
    return awaitMessageOfType(session, responseType, 15_000);
}

async function checkedRequest(session: ICastSession, message: any) {
    const resp = await castRequest(session, message);
    if (resp.error && resp.error.code) {
        throw resp.error;
    }
    debug(" -> ", resp);
    return resp;
}
