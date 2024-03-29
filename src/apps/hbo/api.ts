import jwt from "jsonwebtoken";
import request, { OptionsWithUrl } from "request-promise-native";

import _debug from "debug";
import { read, Token, write } from "../../token";
import { EpisodeContainer } from "../../util/episode-container";

const debug = _debug("babbling:hbo:api");

const CLIENT_CONFIG_URL =
    "https://sessions.api.hbo.com/sessions/v1/clientConfig";
const CONTENT_URL = "https://comet.api.hbo.com/content";
const TOKENS_URL = "https://comet.api.hbo.com/tokens";
const EXPRESS_CONTENT_URL_BASE = "https://comet.api.hbo.com/express-content/";

export const HBO_HEADERS = {
    Accept: "application/vnd.hbo.v9.full+json",
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36",
    "X-Hbo-Client-Version": "Hadron/21.0.1.176 desktop (DESKTOP)",
};

const CLIENT_CONFIG_REQUEST = {
    contract: "codex:1.1.4.1",
    preferredLanguages: ["en-US"],
};

export interface IMarker {
    /** Formatted as eg: "2019-03-27T23:16:25Z" */
    created: string;

    /** The part after `urn:hbo:episode:` */
    cutId: string;

    /** The URN */
    id: string;

    /** In seconds */
    position: number;

    /** In seconds */
    runtime: number;
}

export interface ISeriesMarker {
    focusEpisode: string;
    markerStatus: "START" | "LATEST" | "CONTINUE" | "TOPICAL";
}

export interface HboProfile {
    profileId: string;
    name: string;
    isMe: boolean;
    isPrimary: boolean;
}

type EntityType =
    | "series"
    | "season"
    | "episode"
    | "extra"
    | "feature"
    | "franchise";

interface IHboTitles {
    full: string;
    short: string;
    ultraShort: string;
}

interface IHboRawBody {
    images?: {
        tile?: string;
        tileburnedin?: string;
        tilezoom?: string;
    };

    references?: {
        edits?: string[];
        episodes?: string[];
        extras?: string[];
        items?: string[];
        next?: string;
        previews?: string[];
        season?: string;
        series?: string;
        viewable?: string;
    };

    summaries?: {
        full: string;
        short: string;
    };

    numberInSeason?: number;
    seasonNumber?: number;
    seriesTitles?: IHboTitles;

    titles?: IHboTitles;
}

export interface IHboRawItem {
    id: string;
    statusCode: number;
    headers: Partial<Record<string, string>>;
    body: IHboRawBody;
}

export function unpackUrn(urn: string) {
    const [, , entityType, id, , pageType] = urn.split(":");
    if (pageType != null) {
        return {
            type: entityType as "page" | "tile",
            id,
            pageType: pageType as EntityType,
        };
    } else {
        return {
            type: entityType as EntityType,
            id,
        };
    }
}

export function pageUrnFrom(urn: string) {
    const { id, type } = unpackUrn(urn);
    return `urn:hbo:page:${id}:type:${type}`;
}

function extractIdFromUrn(urnOrId: string) {
    const lastColon = urnOrId.lastIndexOf(":");
    if (lastColon === -1) {
        return urnOrId;
    }

    const { id } = unpackUrn(urnOrId);
    return id;
}

export function urlForUrn(urn: ReturnType<typeof unpackUrn>) {
    return urn.pageType != null
        ? `https://play.hbomax.com/urn:hbo:${urn.type}:${urn.id}`
        : `https://play.hbomax.com/page/urn:hbo:page:${urn.id}:type:${urn.type}`;
}

export function entityTypeFromUrn(urn: string): EntityType {
    const unpacked = unpackUrn(urn);
    if (unpacked.pageType != null) {
        return unpacked.pageType;
    } else {
        return unpacked.type;
    }
}

export interface IHboEpisode {
    urn: string;
    indexInSeason: number;
    season: number;
    title: string;
}

export interface IHboResult {
    imageTemplate?: string;
    urn: string;
    seriesTitle?: string;
    seriesUrn?: string;
    title: string;
}

export class HboApi {
    private refreshToken: string | undefined;
    private refreshTokenExpires = 0;
    private cachedHeadWaiter: string | undefined;

    constructor(private token: Token) {}

    public async stopConcurrentStreams() {
        return this.request("delete", {
            url: "https://comet.api.hbo.com/concurrentStreams",
        });
    }

    /**
     * Given a series Urn, attempt to determine the Urn and
     * start position (in seconds) of the next episode (or
     * episode to resume) for that series
     */
    public async fetchNextEpisodeForSeries(seriesUrn: string) {
        const markersBySeries = await this.getSeriesMarkers();
        const seriesMarker = markersBySeries[seriesUrn];
        if (!seriesMarker) {
            // TODO we could fetch the series' episodes and pick the first
            debug("Available markers:", markersBySeries);
            throw new Error(`No marker for series: ${seriesUrn}`);
        }

        // NOTE: I'm not sure what to do with `markerStatus`...
        const { focusEpisode } = seriesMarker;
        const episodeMarker = await this.getMarkerForEpisode(focusEpisode);

        const result = {
            position: undefined as number | undefined,
            urn: focusEpisode,
        };

        if (episodeMarker) {
            result.position = episodeMarker.position;
        }

        return result;
    }

    public async getEpisodesForSeries(seriesUrn: string) {
        const items = await this.fetchContent([seriesUrn]);
        debug("items=", JSON.stringify(items, null, 2));

        const container = new EpisodeContainer<IHboEpisode>();

        // NOTE: not all episodes are returned, so extract titles
        // for the ones that are
        const episodeTitles: { [key: string]: string } = {};
        for (const item of items) {
            const type = entityTypeFromUrn(item.id);
            if (type === "episode" && item.body.titles != null) {
                episodeTitles[item.id] = item.body.titles?.full;
            }
        }

        for (const item of items) {
            const type = entityTypeFromUrn(item.id);
            if (type !== "season") continue;
            if (!item.body.references || !item.body.references.episodes) {
                continue;
            }

            const episodes = item.body.references.episodes as [];
            for (let i = 0; i < episodes.length; ++i) {
                const urn = episodes[i];
                const season = (item.body.seasonNumber ?? 1) - 1;
                container.add({
                    urn,

                    indexInSeason: i,
                    season,
                    title: episodeTitles[urn] || `S${season + 1}E${i + 1}`,
                });
            }
        }

        return container;
    }

    /**
     * Fetch a map of series URN to its `ISeriesMarker`. It's
     * unclear what criteria is used to determine which series
     * are included in this map.
     */
    public async getSeriesMarkers(): Promise<{ [urn: string]: ISeriesMarker }> {
        const markersResult = await this.fetchContentBody(
            "urn:hbo:series-markers:mine",
        );
        debug("markers result=", markersResult);
        return markersResult.seriesMarkers;
    }

    /**
     * Given `urn:hbo:episode:<ID>` or just `<ID>`,
     * fetch a marker for the episode, or null if none
     */
    public async getMarkerForEpisode(
        episodeUrnOrId: string,
    ): Promise<null | IMarker> {
        const result = await this.getMarkersForEpisodes([episodeUrnOrId]);
        if (result.length) return result[0];
        return null;
    }

    /**
     * Given an array of `urn:hbo:episode:<ID>` or just `<ID>`,
     * fetch a marker for each episode. Episodes for which there
     * are no markers will not have a corresponding element in the
     * responding array, so you should not expect the Markers in
     * the resulting array to be in the same order as the provided
     * array
     */
    public async getMarkersForEpisodes(
        episodeUrnOrIds: string[],
    ): Promise<IMarker[]> {
        const ids = episodeUrnOrIds.map(extractIdFromUrn);

        let episodeMarkers;
        try {
            episodeMarkers = await this.request("get", {
                json: true,
                qs: {
                    limit: ids.length,
                },
                url: `https://markers.api.hbo.com/markers/${ids.join(",")}`,
            });

            debug("Loaded markers for", ids, ":", episodeMarkers);
        } catch (e) {
            // no marker, probably
            debug("Error fetching marker for", ids, ":", e);
        }

        if (Array.isArray(episodeMarkers)) {
            return episodeMarkers;
        }
        if (episodeMarkers) {
            return [episodeMarkers];
        }

        return [];
    }

    public async *queryContinueWatching() {
        const urn = "urn:hbo:continue-watching:mine";
        yield* this.queryPlayables(urn);
    }

    public async *queryRecommended() {
        const urn = "urn:hbo:query:recommended-for-you";
        yield* this.queryPlayables(urn);
    }

    public async *search(title: string) {
        const searchUrn = `urn:hbo:flexisearch:${encodeURIComponent(title)}`;
        yield* this.queryPlayables(searchUrn);
    }

    /*
     * Util methods
     */

    private async *queryPlayables(queryUrn: string) {
        const content = await this.fetchContent([queryUrn]);

        // NOTE: the first one just has references to the ids of
        // the results, which are resolved after it, so skip it
        const results = content.slice(1);
        for (const result of results) {
            const urn = result.body.references?.viewable;
            if (!urn || !result.body.titles) continue;

            const resolved: IHboResult = {
                imageTemplate: result.body.images?.tile,
                seriesTitle: result.body.seriesTitles?.full,
                seriesUrn: result.body.references?.series,
                title: result.body.titles.full,
                urn,
            };
            yield resolved;
        }
    }

    public async resolveFranchiseSeries(franchiseUrn: string) {
        const urn = pageUrnFrom(franchiseUrn);
        const result = await this.fetchExpressContent(urn);
        const reference = result?.[0]?.body?.references?.items?.[0];
        if (reference == null) {
            throw new Error(
                `Unable to resolve series from franchise URN: ${franchiseUrn}`,
            );
        }
        const unpackedReference = unpackUrn(reference);
        return `urn:hbo:series:${unpackedReference.id}`;
    }

    public async extractTokenInfo() {
        const token = read(this.token).trim();

        const tokenData = jwt.decode(token) as any;
        if (
            !tokenData ||
            !tokenData.payload ||
            !tokenData.payload.tokenPropertyData
        ) {
            debug("Invalid token:", tokenData);
            debug("From:", this.token);
            throw new Error("Invalid token");
        }

        const data = tokenData.payload.tokenPropertyData;

        return {
            clientId: data.clientId as string,
            deviceSerialNumber: data.deviceSerialNumber as string,
        };
    }

    public async getRefreshToken() {
        if (Date.now() < this.refreshTokenExpires) {
            debug("Reusing cached refreshToken");
            return this.refreshToken;
        }

        debug("Loading fresh refreshToken...");
        this.cachedHeadWaiter = undefined; // clear cache, just in case
        return this.loadRefreshToken();
    }

    private async getHeadWaiter(token: string) {
        const cached = this.cachedHeadWaiter;
        if (cached != null) {
            return cached;
        }

        const headers = { Authorization: `Bearer ${token}`, ...HBO_HEADERS };
        const { payloadValues } = await request.post({
            body: CLIENT_CONFIG_REQUEST,
            headers,
            json: true,
            url: CLIENT_CONFIG_URL,
        });

        const headWaiter = Object.keys(payloadValues)
            .map((key) => key + ":" + payloadValues[key])
            .join(",");

        this.cachedHeadWaiter = headWaiter;
        return headWaiter;
    }

    /** @internal */
    public async fetchExpressContent(urn: string): Promise<IHboRawItem[]> {
        return this.request("get", {
            json: true,
            url: EXPRESS_CONTENT_URL_BASE + urn,
            qs: {
                "api-version": "v9.0",
                brand: "HBO MAX",
                "country-code": "US",
                "device-code": "desktop",
                language: "en-US",
                "product-code": "hboMax",
                "profile-type": "adult",
                "signed-in": "true",
            },
        });
    }

    /** @internal */
    public async fetchContent(urns: string[]): Promise<IHboRawItem[]> {
        return this.request("post", {
            body: urns.map((urn) => ({ id: urn })),
            json: true,
            url: CONTENT_URL,
        });
    }

    private async fetchContentBody(urn: string) {
        const results = await this.fetchContent([urn]);
        if (results[0].statusCode !== 200) {
            throw new Error(
                `Failed to fetch ${urn}: ${JSON.stringify(results[0])}`,
            );
        }
        return results[0].body as any;
    }

    private async request(
        method: "delete" | "get" | "post",
        opts: OptionsWithUrl,
    ) {
        return request[method](await this.fillRequest(opts));
    }

    private async fillRequest(opts: OptionsWithUrl) {
        const token = await this.getRefreshToken();
        const headWaiter =
            token != null ? await this.getHeadWaiter(token) : undefined;
        return {
            headers: {
                Authorization: `Bearer ${token}`,
                "x-hbo-headwaiter": headWaiter,
                ...HBO_HEADERS,
            },
            ...opts,
        };
    }

    public async listProfiles(): Promise<HboProfile[]> {
        const body = await this.fetchContentBody("urn:hbo:profiles:mine");
        return body.profiles;
    }

    private async loadRefreshToken() {
        // NOTE: I'm not sure if this step is 100% necessary, but
        // it may help to ensure refreshed tokens....

        const { clientId, deviceSerialNumber } = await this.extractTokenInfo();

        // this step fetches some sort of session token that is *not*
        // logged in
        debug("Fetching base session tokens...");
        const baseTokens = await this.postTokensRequest({
            client_id: clientId,
            client_secret: clientId,
            deviceSerialNumber,
            grant_type: "client_credentials",
            scope: "browse video_playback_free",
        });
        debug("baseTokens=", baseTokens);

        // now we exchange the session token above for an updated
        // refresh token
        const realTokens = await this.postTokensRequest(
            {
                grant_type: "refresh_token",
                refresh_token: this.token,
                scope: "browse video_playback device",
            },
            baseTokens.refresh_token,
        );
        debug("Real Tokens:", realTokens);

        // make sure it worked
        if (!realTokens.isUserLoggedIn) {
            throw new Error("Not logged in...");
        }

        // Attempt to select a profile
        this.acceptTokens(realTokens, { persist: false }); // Temporarily accept so we can fetch profiles
        const profiles = await this.listProfiles();

        for (const profile of profiles) {
            if (profile.isMe) {
                debug("Loading profile", profile.name);
                const token = await this.loadProfileToken(profile);
                if (token != null) {
                    return token;
                }

                debug("Did not get a token for profile", profile.name);
            }
        }

        debug("No profile isMe; trying default refreshToken");
        this.acceptTokens(realTokens); // write to disk
        return this.refreshToken as string;
    }

    private async acceptTokens(
        tokens: { refresh_token: string; expires_in: number },
        { persist = true }: { persist?: boolean } = {},
    ) {
        // cache this until expired (see: expires_in)
        this.refreshTokenExpires = Date.now() + tokens.expires_in;
        this.refreshToken = tokens.refresh_token;

        // update the token, if possible
        if (this.refreshToken && persist) {
            await write(this.token, this.refreshToken);
        }

        return tokens.refresh_token;
    }

    private async loadProfileToken(profile: HboProfile) {
        const profileTokens = await this.postTokensRequest(
            {
                grant_type: "user_refresh_profile",
                profile_id: profile.profileId,
                refresh_token: this.refreshToken,
            },
            this.refreshToken,
        );
        if (profileTokens.isUserLoggedIn) {
            debug("Loaded profile", profile.name);
            return this.acceptTokens(profileTokens);
        }

        debug(
            "Failed to load profile token for",
            profile.name,
            "; received=",
            profileTokens,
        );
    }

    private postTokensRequest(body: unknown, token?: string) {
        const headers = {
            Authorization: undefined as string | undefined,
            ...HBO_HEADERS,
        };
        if (token != null) {
            headers.Authorization = `Bearer ${token}`;
        }
        return request.post({
            body,
            headers,
            json: true,
            url: TOKENS_URL,
        });
    }
}
