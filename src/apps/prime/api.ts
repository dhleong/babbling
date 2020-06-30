import _debug from "debug";
const debug = _debug("babbling:PrimeApp:api");

import crypto from "crypto";
import os from "os";
import { gzip } from "zlib";

import { ContentType } from "chakram-ts";
import { generateDeviceId } from "chakram-ts/dist/util";
import request from "request-promise-native";
import { v4 as generateRandomUUID } from "uuid";

import { toArray } from "../../async";

import { IFirstPage, Paginated } from "./api/paginated";
import { IPrimeApiOpts, IPrimeOpts } from "./config";
import { AvailabilityType, IAvailability, ISearchOpts, ISearchResult } from "./model";

// ======= constants ======================================

const DEFAULT_API_DOMAIN = "api.amazon.com";

const ID_NAMESPACE = "com.github.babbler.prime";

const APP_NAME = "com.amazon.avod.thirdpartyclient";
const APP_VERSION = "253188041";
const DEVICE_MODEL = "android";
const DEVICE_TYPE = "A43PXU4ZN2AL1";
const OS_VERSION = "25";
const SOFTWARE_VERSION = "2";

const DEFAULT_QUEUE_LENGTH = 10;

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

// ======= internal types =================================

interface IEpisode {
    episodeNumber: number;
    seasonId: string;
    seasonNumber: number;
    title: string;
    titleId: string;

    completedAfter: number;
    runtimeSeconds: number;
    watchedSeconds: number;
}

interface IWatchNextItem {
    title: string;
    titleId: string;

    completedAfter: number;
    resumeTitleId?: string;
    runtimeSeconds: number;
    watchedSeconds: number;
}

type PromiseType<T extends Promise<any>> = T extends Promise<infer R> ? R : never;
export type ITitleInfo = PromiseType<ReturnType<PrimeApi["getTitleInfo"]>>;

// ======= public interface ===============================

export interface IResumeInfo {
    titleId: string;
    watchedSeconds?: number;

    queue?: string[];
}

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
    ): AsyncIterable<ISearchResult> {
        const opts: ISearchOpts = Object.assign({
            onlyPlayable: true,
        }, searchOpts);

        // ensure we only fetch this once for both requests
        await this.getAccessToken();

        const [withEntitlement, withWatchlist] = await Promise.all([
            toArray(this.searchWithEntitlement(title, opts)),
            toArray(this.searchWithWatchlist(title, opts)),
        ]);

        const watchlistById: {[id: string]: ISearchResult}  = {};
        for (const item of withWatchlist) {
            watchlistById[item.id] = item;
        }

        for (const item of withEntitlement) {
            if (opts.onlyPlayable && !isPlayableNow(item.availability)) {
                continue;
            }

            const itemWithWatchlist = watchlistById[item.id];
            if (!itemWithWatchlist) {
                yield item;
                continue;
            }

            const purchasable = itemWithWatchlist.availability.filter(a =>
                !playableAvailability.has(a.type));

            const compositeAvailability = item.availability.concat(purchasable);
            if (!compositeAvailability.length) {
                // sanity check
                continue;
            }

            yield Object.assign({}, itemWithWatchlist, item, {
                availability: compositeAvailability,
                isPurchased: compositeAvailability.find(a =>
                    a.type === AvailabilityType.OWNED,
                ) !== undefined,
            });
        }
    }

    public async guessResumeInfo(titleId: string): Promise<IResumeInfo | undefined> {
        const [ titleInfo, watchNext ] = await Promise.all([
            this.getTitleInfo(titleId),
            this.watchNextItems(),
        ]);

        if (!titleInfo.series) {
            // TODO: resume movie? maybe amazon handles this for us
            debug("title is not a series");
            return;
        }

        if (!watchNext) {
            debug("no watchNext data");
            return;
        }

        for await (const info of watchNext) {
            debug("Check:", info.titleId, ": ", info.title);
            if (
                info.titleId === titleId
                || (
                    titleInfo.seasonIdSet
                    && titleInfo.seasonIdSet.has(info.titleId)
                )
            ) {
                debug(titleInfo.series.title, "found in watchNext:", info);
                const upNext = await this.resolveNext(info);
                if (!upNext) return;

                const queue = await this.resolveQueue(titleInfo, upNext);
                return {
                    ...upNext,
                    queue,
                };
            }
        }

        debug(`couldn't find ${titleInfo.series.title} in watchNext`);
    }

    public async watchNextItems() {
        // NOTE: we start with fetching the first page of results separately
        // to increase parallelism; this is currently always used in parallel
        // with a getTitleInfo fetch, and if this function were itself an
        // async iterable then node would not run the fetch in parallel; this
        // way, for the common case we have the latency of a single fetch.
        debug("fetch home...");
        const { watchNext } = await this.getHomePage();
        if (!watchNext) return;

        return new Paginated(this, watchNext, parseWatchNextItem);
    }

    public async getHomePage() {
        const { resource } = await this.swiftApiRequest(
            "/cdp/mobile/getDataByTransform/v1/dv-ios/home/v1.js",
        );

        const info: {
            watchNext?: IFirstPage<IWatchNextItem>,
        } = {};

        const watchNextSection = resource.collections.filter((c: any) =>
            c.title === "Watch next",
        )[0];
        if (watchNextSection) {
            info.watchNext = {
                items: watchNextSection.items.map(parseWatchNextItem),
                paginationLink: watchNextSection.paginationLink,
            };
        }

        return info;
    }

    /**
     * This is very similar to `watchNextItems` but is missing things
     * like watchUrl, id while adding cover art (and, at least for now,
     * lacking pagination)
     */
    public async *nextUpItems() {
        const { landingPage } = await this.swiftApiRequest(
            "/cdp/discovery/GetLandingPage",
            {
                pageType: "home",
                version: "mobile-android-v1",
            },
        );
        if (!(landingPage && landingPage.sections && landingPage.sections.center)) return;

        const { collections } = landingPage.sections.center;
        if (!(collections && collections.collectionList)) return;

        const { items } = collections.collectionList.find(isNextUpCollection);
        if (!(items && items.itemList)) return;

        for (const item of items.itemList) {
            const base = parseWatchlistItem(item);
            delete base.watchUrl;
            delete base.id;
            yield base;
        }
    }

    public async getTitleInfo(titleId: string) {
        debug("fetch titleInfo", titleId);
        const { resource } = await this.swiftApiRequest(
            "/cdp/mobile/getDataByTransform/v1/android/atf/v3.jstl",
            {
                itemId: titleId,
            },
        );

        const info: {
            episodes?: IEpisode[],
            movie?: {
                title: string,
                titleId: string,
            },
            series?: {
                title: string,
                titleId: string,
            },
            seasonIds?: string[],
            seasonIdSet?: Set<string>,
            selectedEpisode?: IEpisode,
        } = {};

        if (resource.show) {
            info.series = {
                title: resource.show.title,
                titleId: resource.show.titleId,
            };
        }

        if (resource.seasons) {
            info.seasonIds = resource.seasons.map((s: any) =>
                s.titleId,
            );
            info.seasonIdSet = new Set<string>(info.seasonIds);
        }

        if (resource.episodes) {
            const episodes = resource.episodes.map((e: any) => ({
                episodeNumber: e.episodeNumber,
                seasonId: e.season.titleId,
                seasonNumber: e.seasonNumber,
                title: e.title,
                titleId: e.titleId,

                isSelected: e.selectedEpisode,

                completedAfter: e.completedAfterSeconds,
                runtimeSeconds: e.runtimeSeconds,
                watchedSeconds: e.timecodeSeconds,
            }));
            const selected = episodes.filter((e: any) => e.isSelected);
            if (selected.length) {
                info.selectedEpisode = selected[0];
            }

            info.episodes = episodes;
        }

        if (resource.contentType === "MOVIE") {
            info.movie = {
                title: resource.title,
                titleId: resource.titleId,
            };
        }

        return info;
    }

    public getLanguage() {
        return this.language;
    }

    private async resolveNext(info: IWatchNextItem) {
        if (info.resumeTitleId && !hasFinished(info)) {
            return {
                titleId: info.resumeTitleId,
                watchedSeconds: info.watchedSeconds,
            };
        }

        // fetch episodes of this season and pick the next one
        debug("watchNext is already complete; moving on...");
        const seasonTitle = await this.getTitleInfo(info.titleId);

        if (seasonTitle.episodes) {
            const lastIndex = seasonTitle.episodes.findIndex(e => e.titleId === info.resumeTitleId);
            if (lastIndex < seasonTitle.episodes.length - 1) {
                return seasonTitle.episodes[lastIndex + 1];
            }
        }

        if (info.resumeTitleId) {
            // otherwise, fallback to what we had
            return {
                titleId: info.resumeTitleId,
                watchedSeconds: info.watchedSeconds,
            };
        }
    }

    private async resolveQueue(
        titleInfo: ITitleInfo,
        upNext: IResumeInfo,
        opts: { queueLength?: number } = {},
    ) {
        if (!titleInfo.episodes) {
            debug(`No episodes for ${titleInfo.series}; drop queue`);
            return;
        }

        const upNextIndex = titleInfo.episodes.findIndex(ep =>
            ep.titleId === upNext.titleId);
        if (upNextIndex === -1) {
            debug(`Couldn't find ${upNext.titleId} in episodes; drop queue`);
            return;
        }

        const queueLength = opts.queueLength || DEFAULT_QUEUE_LENGTH;
        const queue: string[] = [];
        for (let i = 0; i < queueLength; ++i) {
            const index = upNextIndex + 1 + i;
            if (index >= titleInfo.episodes.length) {
                break;
            }

            queue.push(titleInfo.episodes[index].titleId);
        }

        return queue;
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

    /**
     * This search method has reliable entitlement info, but fails
     * to provide watchlist attachment
     */
    private async *searchWithEntitlement(
        title: string,
        opts: ISearchOpts,
    ) {
        const response = await this.swiftApiRequest(
            "/cdp/mobile/getDataByTransform/v1/dv-ios/search/initial/v2.js",
            {
                phrase: title,
            },
        );
        const items = response.resource.collections[0].items;

        for (const item of items) {
            const availability: IAvailability[] = [];
            if (item.entitlement && item.entitlement.isEntitled) {
                if (item.isPrime) {
                    availability.push({ type: AvailabilityType.PRIME });
                } else if (item.entitlement.message === "Free with ads") {
                    availability.push({ type: AvailabilityType.FREE_WITH_ADS });
                } else if (item.entitlement.message === "Purchased") {
                    availability.push({ type: AvailabilityType.OWNED });
                } else {
                    availability.push({ type: AvailabilityType.OTHER_SUBSCRIPTION });
                }
            }

            const itemTitle = item.title;
            const type: ContentType = item.contentType.toUpperCase();
            if (
                type === ContentType.SEASON
                    && seasonNumberFromTitle(itemTitle) > 1
            ) {
                // only include the first season of an item
                continue;
            }

            debug("raw item <-", item);
            const id = item.actionPress.analytics.pageTypeId;
            yield {
                availability,
                id,
                title: cleanTitle(itemTitle),
                titleId: item.titleId,
                type,
                watchUrl: `https://www.amazon.com/dp/${id}/?autoplay=1`,
            };
        }
    }

    /**
     * This search method has watchlist presence included, but fails
     * to provide "Free with ads" availability
     */
    private async *searchWithWatchlist(
        title: string,
        opts: ISearchOpts,
    ) {
        const items = await this.swiftApiCollectionRequest("/swift/page/search", {
            phrase: title,
        });

        for (const item of items) {
            const { type } = item.decoratedTitle.catalog;
            if (
                type === ContentType.SEASON
                    && item.decoratedTitle.catalog.seasonNumber > 1
            ) {
                // only include the first season of an item
                continue;
            }

            yield parseWatchlistItem(item);
        }
    }

    private async swiftApiCollectionRequest(path: string, qs: {} = {}) {
        const response = await this.swiftApiRequest(path, qs);
        const widgets = response.page.sections.center.widgets.widgetList;
        for (const w of widgets) {
            if (w.type === "collection") {
                return w.items.itemList;
            }
        }

        throw new Error("No collection found");
    }

    private async swiftApiRequest(path: string, qs: {} = {}) {
        const accessToken = await this.getAccessToken();
        return request.get({
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
    }
}

function getIpAddress() {
    const ifaces = os.networkInterfaces();
    for (const ifaceName of Object.keys(ifaces)) {
        const list = ifaces[ifaceName];
        if (!list) continue;

        for (const iface of list) {
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

    if (!item.titleActions) {
        // quick shortcut
        return result;
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

const playableAvailability = new Set([
    AvailabilityType.FREE_WITH_ADS,
    AvailabilityType.OTHER_SUBSCRIPTION,
    AvailabilityType.OWNED,
    AvailabilityType.PRIME,
]);

function isPlayableNow(availability: IAvailability[]) {
    for (const a of availability) {
        if (playableAvailability.has(a.type)) {
            return true;
        }
    }

    return false;
}

function seasonNumberFromTitle(title: string) {
    const m = title.match(/Season (\d+)/);
    if (m) return parseInt(m[1], 10);
    return -1;
}

function hasFinished(info: IWatchNextItem) {
    if (!info.watchedSeconds) return false;
    if (info.watchedSeconds >= info.completedAfter) return true;

    // amazon's completedAfter numbers can be bogus, especially
    // if the item has ads at the end. screw that.
    return (info.watchedSeconds / info.completedAfter) > 0.91;
}

function parseWatchNextItem(item: any): IWatchNextItem {
    return {
        title: item.title,
        titleId: item.titleId,

        completedAfter: item.playAndProgress.completedAfter,
        resumeTitleId: item.playAndProgress.titleId,
        runtimeSeconds: item.playAndProgress.runtimeSeconds,
        watchedSeconds: item.playAndProgress.watchedSeconds,
    };
}

function parseWatchlistItem(item: any) {
    const availability = availabilityOf(item);
    const id = item.analytics.local.pageTypeId;
    return {
        availability,
        cover: item.decoratedTitle.images.imageUrls.detail_page_cover
        || item.decoratedTitle.images.imageUrls.detail_page_hero,
        desc: item.decoratedTitle.catalog.synopsis,
        id,
        isInWatchlist: item.decoratedTitle.computed.simple.IS_IN_WATCHLIST,
        title: cleanTitle(item.decoratedTitle.catalog.title),
        titleId: item.titleId,
        type: item.decoratedTitle.catalog.type,
        watchUrl: `https://www.amazon.com/dp/${id}/?autoplay=1`,
    };
}

function isNextUpCollection(c: any): boolean {
    if (c.debugAttributes && c.debugAttributes.includes("ATVWatchNext")) {
        return true;
    }

    if (c.itemTypeToActionMap && c.itemTypeToActionMap.titleCard) {
        return c.itemTypeToActionMap.titleCard.includes((action: any) => {
            return action.parameters && action.parameters.listType === "AIV:NextUp";
        });
    }

    return false;
}
