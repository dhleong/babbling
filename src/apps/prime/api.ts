import _debug from "debug";
const debug = _debug("babbling:PrimeApp:api");

import crypto from "crypto";
import os from "os";
import { gzip } from "zlib";

import { ContentType } from "chakram-ts";
import { generateDeviceId } from "chakram-ts/dist/util";
import request from "request-promise-native";
import generateRandomUUID from "uuid/v4";

import { IPrimeApiOpts, IPrimeOpts } from "./config";
import { AvailabilityType, IAvailability, ISearchOpts } from "./model";

// ======= constants ======================================

const DEFAULT_API_DOMAIN = "api.amazon.com";

const ID_NAMESPACE = "com.github.babbler.prime";

const APP_NAME = "com.amazon.avod.thirdpartyclient";
const APP_VERSION = "253188041";
const DEVICE_MODEL = "android";
const DEVICE_TYPE = "A43PXU4ZN2AL1";
const OS_VERSION = "25";
const SOFTWARE_VERSION = "2";

// ======= utils ==========================================

export async function generateFrcCookies(
    deviceId: string,
    language: string,
) {
    const cookies = JSON.stringify({
        ApplicationName: APP_NAME,
        ApplicationVersion: APP_VERSION,
        DeviceLanguage: language,
        DeviceName: "walleye/google/Pixel 2",
        DeviceOSVersion: "google/walleye/walleye:8.1.0/OPM1.171019.021/4565141:user/release-keys",
        IpAddress: getIpAddress(),
        ScreenHeightPixels: "1920",
        ScreenWidthPixels: "1280",
        TimeZone: "-04:00",
    });

    debug("generating FRC cookies from: ", cookies);

    // gzip
    const zipped: Buffer = await new Promise((resolve, reject) => {
        gzip(cookies, {}, (e, result) => {
            if (e) reject(e);
            else resolve(result);
        });
    });

    // encrypt the cookies JSON
    // don't ask about the salts used for the keys; I don't make the rules ;)
    const key = createSaltedKey(deviceId, "AES/CBC/PKCS7Padding");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    const cipheredBase = cipher.update(zipped);
    const ciphered = Buffer.concat([cipheredBase, cipher.final()]);

    // create an hmac digest containing the IV and the ciphered data
    const hmac = crypto.createHmac(
        "sha256",
        createSaltedKey(deviceId, "HmacSHA256"),
    );
    hmac.update(iv);
    hmac.update(ciphered);
    const hmacd = hmac.digest();

    // build the cookies buffer
    const toBase64Encode = Buffer.concat([
        Buffer.of(0),
        hmacd.slice(0, 8),
        iv,
        ciphered,
    ]);

    return toBase64Encode.toString("base64");
}

function createSaltedKey(key: string, salt: crypto.BinaryLike) {
    return crypto.pbkdf2Sync(
        key,
        salt,
        1000, // iterations
        16, // key length (in bytes, vs Java's bits)
        "SHA1", // hash
    );
}

// ======= public interface ===============================

export class PrimeApi {
    public readonly deviceId: string;

    private readonly opts: IPrimeApiOpts;
    private readonly language = "en-US";
    private readonly deviceNameBase = "User\u2019s Babbling";

    private accessToken: string | null = null;
    private accessTokenExpiresAt: number = -1;

    constructor(options: IPrimeApiOpts = {}) {
        this.opts = options;
        this.deviceId = options.deviceId || generateDeviceId(
            ID_NAMESPACE,
            os.hostname(),
        ).substring(0, 32);
    }

    public async login(email: string, password: string) {
        const body: any = {
            auth_data: {
                use_global_authentication: "true",
                user_id_password: {
                    password,
                    user_id: email,
                },
            },
            cookies: {
                domain: ".amazon.com",
                website_cookies: [],
            },
            requested_extensions: [
                "device_info",
                "customer_info",
            ],
            requested_token_type: ["bearer", "mac_dms", "website_cookies"],
        };

        const registrationData = this.generateDeviceData();
        registrationData.device_name = `${this.deviceNameBase}%DUPE_STRATEGY_2ND%`;
        body.registration_data = registrationData;

        const frc = await generateFrcCookies(this.deviceId, this.language);
        if (frc !== null) {
            debug(`generated cookies: ${frc}`);
            body.user_context_map = {
                frc,
            };
        }

        const response = await request.post({
            body,
            headers: this.generateHeaders(),
            json: true,
            url: this.buildUrl("/auth/register"),
        });

        const { success } = response.response;
        if (!success) throw new Error(`Login unsuccessful: ${response}`);
        if (!(success && success.tokens)) {
            throw new Error("Logged in successfully but didn't get tokens");
        }

        debug("login successful = ", success);
        debug("cookies = ", success.tokens.website_cookies);
        return {
            cookies: success.tokens.website_cookies.map((c: any) => {
                return `${c.Name}=${c.Value}`;
            }).join("; "),
            refreshToken: success.tokens.bearer.refresh_token,
        };
    }

    public async generatePreAuthorizedLinkCode(refreshToken: string) {
        debug(`generating pre-authorized link code...`);
        const body = {
            auth_data: {
                access_token: refreshToken,
            },
            code_data: this.generateDeviceData(),
        };

        const response = await request.post({
            body,
            headers: this.generateHeaders(),
            json: true,
            url: this.buildUrl("/auth/create/code"),
        });

        if (!response.code) {
            throw new Error(JSON.stringify(response));
        }

        // should we cache for response.expires_in seconds?
        debug(`generated pre-authorized link code: ${response.code}`);
        return response.code;
    }

    public async *search(
        title: string,
        searchOpts: ISearchOpts = {},
    ) {
        const opts: ISearchOpts = Object.assign({
            onlyPlayable: true,
        }, searchOpts);

        const items = await this.swiftApiRequest("/swift/page/search", {
            phrase: title,
        });

        for (const item of items) {
            const availability = availabilityOf(item);
            if (!availability.length) {
                continue;
            }

            if (opts.onlyPlayable && !isPlayableNow(availability)) {
                continue;
            }

            const { type } = item.decoratedTitle.catalog;
            if (
                type === ContentType.SEASON
                    && item.decoratedTitle.catalog.seasonNumber > 1
            ) {
                // only include the first season of an item
                continue;
            }

            const id = item.analytics.local.pageTypeId;
            yield {
                availability,
                cover: item.decoratedTitle.images.imageUrls.detail_page_cover
                    || item.decoratedTitle.images.imageUrls.detail_page_hero,
                desc: item.decoratedTitle.catalog.synopsis,
                id,
                isInWatchlist: item.decoratedTitle.computed.simple.IS_IN_WATCHLIST,
                isPurchased: availability.find(a => a.type === AvailabilityType.OWNED) !== undefined,
                title: cleanTitle(item.decoratedTitle.catalog.title),
                type,
                watchUrl: `https://www.amazon.com/dp/${id}/?autoplay=1`,
            };
        }
    }

    public getLanguage() {
        return this.language;
    }

    private buildUrl(path: string): string {
        const domain = this.apiDomain();
        return `https://${domain}/${path}`;
    }

    private buildApiUrl(path: string): string {
        // TODO get region from /profile
        const domain = "na.api.amazonvideo.com";
        return `https://${domain}${path}`;
    }

    private apiDomain(): string {
        return this.opts.apiDomain || DEFAULT_API_DOMAIN;
    }

    private generateDeviceData(): any {
        return {
            domain: "Device",

            app_name: APP_NAME,
            app_version: APP_VERSION,
            device_model: DEVICE_MODEL,
            device_serial: this.deviceId,
            device_type: DEVICE_TYPE,
            os_version: OS_VERSION,
            software_version: SOFTWARE_VERSION,
        };
    }

    private generateHeaders() {
        return {
            "Accept-Charset": "utf-8",
            "x-amzn-identity-auth-domain": this.apiDomain(),
            "x-amzn-requestid": generateRandomUUID(),
        };
    }

    private async getAccessToken() {
        const existing = this.accessToken;
        const existingExpires = this.accessTokenExpiresAt;
        if (existing && Date.now() < existingExpires)  {
            return existing;
        }

        const opts = this.opts as IPrimeOpts;
        if (!opts.refreshToken) {
            throw new Error("No refresh token provided");
        }

        const response = await request.post({
            form: {
                app_name: APP_NAME,
                requested_token_type: "access_token",
                source_token: opts.refreshToken,
                source_token_type: "refresh_token",
            },
            headers: this.generateHeaders(),
            json: true,
            url: this.buildUrl("/auth/token"),
        });

        if (!response.access_token) {
            throw new Error(`Unable to acquire access token: ${response}`);
        }

        this.accessToken = response.access_token;
        this.accessTokenExpiresAt = Date.now() + response.expires_in * 1000;
        return this.accessToken;
    }

    private async swiftApiRequest(path: string, qs: {} = {}) {
        const accessToken = await this.getAccessToken();
        const response = await request.get({
            headers: Object.assign(this.generateHeaders(), {
                Accept: "application/json",
                Authorization: `Bearer ${accessToken}`,
            }),
            json: true,
            qs: Object.assign({
                decorationScheme: "bond-landing-decoration",
                deviceId: this.deviceId,
                deviceTypeId: DEVICE_TYPE,
                featureScheme: "mobile-android-features-v7",
                firmware: "7.54.3923",
                format: "json",
                titleActionScheme: "bond-2",
                version: "mobile-android-v2",
            }, qs),
            url: this.buildApiUrl(path),
        });
        const widgets = response.page.sections.center.widgets.widgetList;
        for (const w of widgets) {
            if (w.type === "collection") {
                return w.items.itemList;
            }
        }

        throw new Error("No collection found");
    }
}

function getIpAddress() {
    const ifaces = os.networkInterfaces();
    for (const ifaceName of Object.keys(ifaces)) {
        for (const iface of ifaces[ifaceName]) {
            if (!iface.internal && iface.family === "IPv4") {
                return iface.address;
            }
        }
    }
}

function availabilityOf(item: any): IAvailability[] {
    const result: IAvailability[] = [];
    let isPrime = false;
    if (item.decoratedTitle.computed.simple.PRIME_BADGE && item.analytics.local.isPrimeCustomer === "Y") {
        // included in active prime subscription
        result.push({ type: AvailabilityType.PRIME });
        isPrime = true;
    }

    if (item.titleActions.isPlayable && item.titleActions.playbackSummary.includes("You purchased")) {
        // explicitly purchased
        result.push({ type: AvailabilityType.OWNED });
    } else if (item.titleActions.isPlayable && !isPrime) {
        // if not purchased, it's probably included in prime, etc.
        result.push({ type: AvailabilityType.PRIME });
    } else if (!item.titleActions.isPlayable) {
        try {
            const summary: any = JSON.stringify(item.titleActions.titleSummary);
            if (summary.type === "purchase" && summary.price) {
                const type = item.titleActions.titleSummary.includes("Rent")
                    ? AvailabilityType.RENTABLE
                    : AvailabilityType.PURCHASABLE;
                result.push({
                    price: summary.price,
                    type,
                } as any);
            }
        } catch (e) {
            // ignore
        }
    }

    return result;
}

function cleanTitle(title: string) {
    return title.replace(/( -)? Season \d+/, "")
        .replace("(4K UHD)", "");
}

function isPlayableNow(availability: IAvailability[]) {
    for (const a of availability) {
        if (a.type === AvailabilityType.OWNED) return true;
        if (a.type === AvailabilityType.PRIME) return true;
    }

    return false;
}
