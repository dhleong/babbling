import _debug from "debug";

import request from "request-promise-native";

import { EpisodeResolver } from "../../util/episode-resolver";

import { IHuluOpts } from "./config";

const debug = _debug("babbling:hulu:api");

const DISCOVER_BASE = "https://discover.hulu.com/content/v4";

const ENTITY_DISCOVER_URL = `${DISCOVER_BASE}/entity/deeplink?schema=2&referral_host=www.hulu.com`;
const SEARCH_URL = `${DISCOVER_BASE}/search/entity?language=en&device_context_id=2&limit=64&include_offsite=true&schema=2&referral_host=www.hulu.com`;
const SERIES_HUB_URL_FORMAT = `${DISCOVER_BASE}/hubs/series/%s/?schema=2&referral_host=www.hulu.com`;
const SEASON_HUB_URL_FORMAT = `${DISCOVER_BASE}/hubs/series/%s/season/%d?limit=999&schema=9&referral_host=www.hulu.com`;
const RECENT_URL = `${DISCOVER_BASE}/hubs/watch-history?schema=9&referral_host=production`;

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36";

const CSRF_URL = "https://www.hulu.com/api/3.0/generate_csrf_value?&for_hoth=true&path=/v1/web/chromecast/authenticate";
const CSRF_COOKIE_NAME = "_tcv";

const CHROMECAST_AUTH_URL = "https://auth.hulu.com/v1/web/chromecast/authenticate";

export const supportedEntityTypes = new Set(["series", "movie", "episode"]);

function extractCookie(cookies: string, cookieName: string) {
    const cookieStart = cookies.indexOf(cookieName);
    const cookieEnd = cookies.indexOf(";", cookieStart);
    return cookies.substring(cookieStart + cookieName.length + 1, cookieEnd);
}

export interface IHuluEpisode {
    entity: any;
    id: string;
    indexInSeason: number;
    name: string;
    season: number;
}

export class HuluApi {
    public readonly userId: string;
    public readonly profileId: string;

    private readonly cookies: string;

    // session state:
    private userToken: string | undefined;
    private userTokenExpires: number | undefined;
    private csrf: string | undefined;

    constructor(options: IHuluOpts) {
        this.cookies = "";
        if (options && options.cookies) {
            if (typeof options.cookies !== "string") {
                throw new Error("Invalid cookies format");
            }

            this.cookies = options.cookies.trim();
        }

        this.userId = extractCookie(this.cookies, "_hulu_uid");
        this.profileId = extractCookie(this.cookies, "_hulu_pid");
    }

    public async getUserToken() {
        if (
            this.userToken
            && this.userTokenExpires
            && Date.now() < this.userTokenExpires
        ) {
            // still valid
            return this.userToken;
        }

        await this.ensureCSRF();

        debug("fetch user token");
        debug(` -> csrf='${this.csrf}'`);
        const rawResponse = await request.post({
            body: `csrf=${this.csrf}`,
            headers: {
                Accept: "application/json",
                "Content-Type": "text/plain;charset=UTF-8",
                ...this.generateHeaders(),
            },
            url: CHROMECAST_AUTH_URL,
        });
        const json = JSON.parse(rawResponse);
        debug("got:", json);

        this.userToken = json.user_token;
        this.userTokenExpires = Date.now() + json.expires_in * 1000;
        return json.user_token;
    }

    public async loadEntityById(entityId: string) {
        debug(`load entity ${entityId}`);

        const { entity } = await request({
            headers: this.generateHeaders(),
            json: true,
            qs: {
                entity_id: entityId,
            },
            url: ENTITY_DISCOVER_URL,
        });

        debug(`loaded entity ${entityId}:`, entity);

        const { _type: type } = entity;

        if (type === "series") {
            throw new Error("Use resumeSeries for series");
        }

        if (!supportedEntityTypes.has(type)) {
            // for example, 'series'
            throw new Error(`Unsupported entity '${entity.name}' (type '${type}')`);
        }

        return entity;
    }

    public async search(query: string): Promise<any[]> {
        const { groups } = await request({
            headers: this.generateHeaders(),
            json: true,
            qs: {
                search_query: query,
            },
            url: SEARCH_URL,
        });

        const { results } = groups.find((it: any) => it.category === "top results");

        return results.filter((item: any) => {
            // if it's prompting to upsell, we probably can't cast it
            if (item.actions.upsell) return false;

            // similarly, if we're prompted to "get related" it's not on hulu
            return !item.actions.get_related;
        });
    }

    public episodeResolver(seriesId: string) {
        const api = this; // eslint-disable-line @typescript-eslint/no-this-alias
        return new EpisodeResolver<IHuluEpisode>({
            async* episodesInSeason(seasonIndex: number) {
                let page: string | undefined;
                do {
                    const { items, nextPage } = await api.episodesInSeason(
                        seriesId,
                        seasonIndex + 1,
                        page,
                    );

                    yield items;
                    page = nextPage;
                } while (page);
            },
        });
    }

    public async episodesInSeason(
        seriesId: string,
        seasonNumber: number,
        pagination?: string,
    ) {
        debug(`Fetching episodesInSeason for series ${seriesId}`);

        const url = pagination || SEASON_HUB_URL_FORMAT.replace("%s", seriesId)
            .replace("%d", seasonNumber.toString());

        const json = await request({
            headers: {
                Cookie: this.cookies,
                Origin: "https://www.hulu.com",
                Referer: "https://www.hulu.com/",
                "User-Agent": USER_AGENT,
            },
            json: true,
            url,
        });

        return {
            items: json.items.map((item: any, index: number) => ({
                entity: item,
                id: item.id,
                indexInSeason: index,
                name: item.name,
                season: seasonNumber - 1,
            })) as IHuluEpisode[],
            nextPage: json.pagination.next as string | undefined,
        };
    }

    public async findNextEntityForSeries(seriesId: string) {
        debug(`Fetching next entity for series ${seriesId}`);

        const json = await request({
            headers: {
                Cookie: this.cookies,
                Origin: "https://www.hulu.com",
                Referer: "https://www.hulu.com/",
                "User-Agent": USER_AGENT,
            },
            json: true,
            url: SERIES_HUB_URL_FORMAT.replace("%s", seriesId),
        });

        if (!(json.details && json.details.vod_items && json.details.vod_items.focus)) {
            debug("Full response:", json);
            throw new Error(`Unable to find next episode for ${seriesId}`);
        }

        const { entity } = json.details.vod_items.focus;
        debug(`Next entity for series ${seriesId}:`, entity);

        return entity;
    }

    public async* fetchRecent() {
        const { components } = await request({
            headers: this.generateHeaders(),
            json: true,
            url: RECENT_URL,
        });
        if (!(components && components.length)) return;

        const { items/* , pagination */ } = components[0];
        for (const item of items) {
            yield item;
        }
    }

    private generateHeaders() {
        return {
            Cookie: this.cookies,
            Origin: "https://www.hulu.com",
            Referer: "https://www.hulu.com/",
            "User-Agent": USER_AGENT,
        };
    }

    private async ensureCSRF() {
        if (this.csrf) return;

        debug("fetch CSRF");
        const response = await request({
            headers: { authority: "www.hulu.com", ...this.generateHeaders() },
            resolveWithFullResponse: true,
            url: CSRF_URL,
        });
        debug("got cookies:", response.headers["set-cookie"]);
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
}
