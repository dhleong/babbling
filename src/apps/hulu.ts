
import request from "request-promise-native";

import _debug from "debug";
const debug = _debug("babbling:hulu");

import { IDevice } from "../cast";
import { CookiesConfigurable } from "../cli/configurables";
import { BaseApp } from "./base";
import { awaitMessageOfType } from "./util";

const APP_ID = "3EC252A5";
const HULU_PLUS_NS = "urn:x-cast:com.hulu.plus";

const CSRF_URL = "https://www.hulu.com/api/3.0/generate_csrf_value?&for_hoth=true&path=/v1/web/chromecast/authenticate";
const CSRF_COOKIE_NAME = "_tcv";

const CHROMECAST_AUTH_URL = "https://auth.hulu.com/v1/web/chromecast/authenticate";

// tslint:disable
const ENTITY_DISCOVER_URL = "https://discover.hulu.com/content/v4/entity/deeplink?schema=2&referral_host=www.hulu.com";
const SERIES_HUB_URL_FORMAT = "https://discover.hulu.com/content/v4/hubs/series/%s/?schema=2&referral_host=www.hulu.com";
const SEARCH_URL = "https://discover.hulu.com/content/v4/search/entity?language=en&device_context_id=2&limit=64&include_offsite=false&schema=2&referral_host=www.hulu.com";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36";
// tslint:enable

function extractCookie(cookies: string, cookieName: string) {
    const cookieStart = cookies.indexOf(cookieName);
    const cookieEnd = cookies.indexOf(";", cookieStart);
    return cookies.substring(cookieStart + cookieName.length + 1, cookieEnd);
}

function eabIdFromEntity(entity: any) {
    if (entity.bundle && entity.bundle.eab_id) {
        return entity.bundle.eab_id;
    }
    const contentId = entity.content_id || "NULL";
    const bundleId = entity.bundle ? entity.bundle.id : "NULL";
    return `EAB::${entity.id}::${contentId}::${bundleId}`;
}

export interface IHuluOpts {
    /**
     * A string of cookies as might be retrieved from the "copy as
     * cURL" from any request on hulu.com in Chrome's network
     * inspector
     */
    cookies: string;
}

const UUID_LENGTH = 36;

function seemsLikeValidUUID(uuid: string) {
    return /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/.test(uuid);
}

const supportedEntityTypes = new Set(["series", "movie", "episode"]);

export class HuluApp extends BaseApp {

    public static configurable = new CookiesConfigurable<IHuluOpts>("https://www.hulu.com");

    public static ownsUrl(url: string) {
        return url.includes("hulu.com");
    }

    public static async createPlayable(url: string) {
        if (url.length < UUID_LENGTH) {
            throw new Error(`'${url}' doesn't seem playable`);
        }

        const id = url.substr(-UUID_LENGTH);
        if (url.includes("/series/")) {
            debug("detected series", id);

            return async (app: HuluApp) => app.resumeSeries(id);
        }

        if (seemsLikeValidUUID(id)) {
            debug("detected some specific entity", id);
            return async (app: HuluApp) => app.play(id, {});
        }

        throw new Error(`Not sure how to play '${url}'`);
    }

    public static async *queryByTitle(
        title: string,
        opts: IHuluOpts,
    ) {
        const { groups } = await request({
            headers: {
                "Cookie": opts.cookies,
                "Origin": "https://www.hulu.com",
                "Referer": "https://www.hulu.com/",
                "User-Agent": USER_AGENT,
            },
            json: true,
            qs: {
                search_query: title,
            },
            url: SEARCH_URL,
        });

        const { results } = groups.find((it: any) =>
            it.category === "top results",
        );
        for (const item of results) {
            if (item.actions.upsell) {
                // if it's prompting to upsell, we probably can't cast it
                continue;
            }

            const id = item.metrics_info.entity_id;
            const type = item.metrics_info.entity_type;
            if (!supportedEntityTypes.has(type)) {
                // skip!
                continue;
            }

            const url = "https://www.hulu.com/" + type + "/" + id;
            yield {
                appName: "HuluApp",
                desc: item.visuals.body.text,
                title: item.metrics_info.entity_name,
                url,

                playable: async (app: HuluApp) => {
                    if (type === "series") {
                        return app.resumeSeries(id);
                    }
                    return app.play(id, {});
                },
            };
        }
    }

    private readonly cookies: string;

    private userId: string;
    private profileId: string;

    // session state:
    private userToken: string | undefined;
    private userTokenExpires: number | undefined;
    private csrf: string | undefined;

    constructor(device: IDevice, options: IHuluOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: HULU_PLUS_NS,
        });

        this.cookies = "";
        if (options && options.cookies) {
            const { cookies } = options;
            if (typeof cookies !== "string") {
                throw new Error("Invalid cookies format");
            }

            this.cookies = cookies.trim();
        }

        this.userId = extractCookie(this.cookies, "_hulu_uid");
        this.profileId = extractCookie(this.cookies, "_hulu_pid");
    }

    /**
     * Options:
     * - startTime: Time in seconds to start playback. Defaults to
     *              resuming the episode (maybe?)
     */
    public async play(
        videoId: string,
        { startTime }: {
            startTime?: number,
        },
    ) {
        const extraData = {} as any;
        if (startTime) {
            extraData.offset_msec = startTime * 1000;
        }

        return this.playEntity(
            this.loadEntityById(videoId),
            extraData,
        );
    }

    /**
     * Attempt to play the "next" episode for the given series.
     */
    public async resumeSeries(seriesId: string) {
        return this.playEntity(
            this.findNextEntityForSeries(seriesId),
            {},
        );
    }

    private async playEntity(
        entityPromise: Promise<any>,
        extraData: { offset_msec?: number },
    ) {
        const [ , s, entity ] = await Promise.all([
            this.ensureUserToken(),
            this.ensureCastSession(),
            entityPromise,
        ]);

        const data = Object.assign({
            autoplay: {
                autoplay: "on",
            },
            caption_style_data: {
                background_color: 2130706432,
                edge_color: 0,
                edge_type: "dropshadow",
                font_family: "Arial",
                text_color: 4294967295,
                text_size: 0.7777777777777778,
            },
            captions_language: "en",
            eab_id: eabIdFromEntity(entity),
            entity,
            expiration_time: 43200000,
            latitude: -1,
            limit_ad_tracking: true,
            longitude: -1,
            profile: {
                profile_id: this.profileId,
            },
            show_prerolls: true,
            user_id: this.userId,
            user_token: this.userToken,
        }, extraData);

        s.send({
            data,
            event_type: "start",
            message_id: 1,
        });

        debug("sent");
        let ms;
        do {
            ms = await awaitMessageOfType(s, "MEDIA_STATUS");
            debug(ms);
        } while (!ms.status.length);
        debug(ms.status[0].media);
    }

    private async ensureUserToken() {
        if (
            this.userToken
            && this.userTokenExpires
            && Date.now() < this.userTokenExpires
        ) {
            // still valid
            return;
        }

        await this.ensureCSRF();

        debug("fetch user token", this.cookies);
        debug(` -> csrf='${this.csrf}'`);
        const rawResponse = await request.post({
            body: `csrf=${this.csrf}`,
            headers: {
                "Accept": "application/json",
                "Content-Type": "text/plain;charset=UTF-8",
                "Cookie": this.cookies,
                "Origin": "https://www.hulu.com",
                "Referer": "https://www.hulu.com/",
                "User-Agent": USER_AGENT,
            },
            url: CHROMECAST_AUTH_URL,
        });
        const json = JSON.parse(rawResponse);
        debug("got:", json);

        this.userToken = json.user_token;
        this.userTokenExpires = Date.now() + json.expires_in * 1000;
    }

    private async ensureCSRF() {
        if (this.csrf) return;

        debug("fetch CSRF");
        const response = await request({
            headers: {
                "Cookie": this.cookies,
                "User-Agent": USER_AGENT,
                "authority": "www.hulu.com",
                "referer": "https://www.hulu.com/",
            },
            resolveWithFullResponse: true,
            url: CSRF_URL,
        });
        debug(`got cookies:`, response.headers["set-cookie"]);
        debug("body=", response.body);

        for (const raw of response.headers["set-cookie"]) {
            if (!raw.startsWith(CSRF_COOKIE_NAME)) continue;

            const csrf = raw.substring(CSRF_COOKIE_NAME.length + 1, raw.indexOf(";"));
            this.csrf = csrf;
            debug(`got CSRF token: ${csrf}`);
        }

        if (!this.csrf) {
            throw new Error("Could not get CSRF token");
        }
    }

    private async loadEntityById(entityId: string) {
        debug(`load entity ${entityId}`);

        const { entity } = await request({
            headers: {
                "Cookie": this.cookies,
                "Origin": "https://www.hulu.com",
                "Referer": "https://www.hulu.com/",
                "User-Agent": USER_AGENT,
            },
            json: true,
            qs: {
                entity_id: entityId,
            },
            url: ENTITY_DISCOVER_URL,
        });

        debug(`loaded entity ${entityId}:`, entity);

        if (entity._type === "series") {
            throw new Error("Use resumeSeries for series");
        }

        if (!supportedEntityTypes.has(entity._type)) {
            // for example, 'series'
            throw new Error(`Unsupported entity '${entity.name}' (type '${entity._type}')`);
        }

        return entity;
    }

    private async findNextEntityForSeries(seriesId: string) {
        debug(`Fetching next entity for series ${seriesId}`);

        const json = await request({
            headers: {
                "Cookie": this.cookies,
                "Origin": "https://www.hulu.com",
                "Referer": "https://www.hulu.com/",
                "User-Agent": USER_AGENT,
            },
            json: true,
            url: SERIES_HUB_URL_FORMAT.replace("%s", seriesId),
        });

        if (!(json.details && json.details.vod_items && json.details.vod_items.focus)) {
            debug(`Full response:`, json);
            throw new Error(`Unable to find next episode for ${seriesId}`);
        }

        const entity = json.details.vod_items.focus.entity;
        debug(`Next entity for series ${seriesId}:`, entity);

        return entity;
    }

}
