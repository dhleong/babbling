import jwt from "jsonwebtoken";
import request, { OptionsWithUrl } from "request-promise-native";

import _debug from "debug";
import { read, Token, write } from "../../token";
import { EpisodeContainer } from "../../util/episode-container";

const debug = _debug("babbling:hbo:api");

const CONTENT_URL = "https://comet.api.hbo.com/content";
const TOKENS_URL = "https://comet.api.hbo.com/tokens";

export const HBO_HEADERS = {
    Accept: "application/vnd.hbo.v9.full+json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36",
    "X-Hbo-Client-Version": "Hadron/21.0.1.176 desktop (DESKTOP)",
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

type EntityType = "series" | "season" | "episode" | "extra" | "feature";

export function unpackUrn(urn: string) {
    const [, , entityType, id, , pageType] = urn.split(":");
    if (entityType == "page") {
        return {
            type: "page" as const,
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

function extractIdFromUrn(urnOrId: string) {
    const lastColon = urnOrId.lastIndexOf(":");
    if (lastColon === -1) {
        return urnOrId;
    }

    const { id } = unpackUrn(urnOrId);
    return id;
}

export function entityTypeFromUrn(urn: string): EntityType {
    const unpacked = unpackUrn(urn);
    if (unpacked.type === "page") {
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

export class HboApi {
    private refreshToken: string | undefined;
    private refreshTokenExpires = 0;

    constructor(
        private token: Token,
    ) {}

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

        const container = new EpisodeContainer<IHboEpisode>();

        // NOTE: not all episodes are returned, so extract titles
        // for the ones that are
        const episodeTitles: { [key: string]: string } = {};
        for (const item of items) {
            const type = entityTypeFromUrn(item.id);
            if (type === "episode") {
                episodeTitles[item.id] = item.body.titles.full;
            }
        }

        for (const item of items) {
            const type = entityTypeFromUrn(item.id);
            if (type !== "season") continue;
            if (!item.body.references || !item.body.references.episodes) continue;

            const episodes = item.body.references.episodes as [];
            for (let i = 0; i < episodes.length; ++i) {
                const urn = episodes[i];
                const season = item.body.seasonNumber - 1;
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
        const markersResult = await this.fetchContent(["urn:hbo:series-markers:mine"]);
        debug("markers result=", markersResult);
        return markersResult[0].body.seriesMarkers;
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
        } if (episodeMarkers) {
            return [episodeMarkers];
        }

        return [];
    }

    public async* search(title: string) {
        const searchUrn = `urn:hbo:flexisearch:${encodeURIComponent(title)}`;
        const content = await this.fetchContent([searchUrn]);

        // NOTE: the first one just has references to the ids of
        // the results, which are resolved after it, so skip it
        const results = content.slice(1);
        for (const result of results) {
            const urn: string = result.body.references.viewable;
            if (!urn) continue;

            yield {
                title: result.body.titles.full as string,
                type: result.body.contentType as "FEATURE" | "SERIES" | "SERIES_EPISODE",
                urn,
            };
        }
    }

    /*
     * Util methods
     */

    public async extractTokenInfo() {
        const token = read(this.token).trim();

        const tokenData = jwt.decode(token) as any;
        if (!tokenData || !tokenData.payload || !tokenData.payload.tokenPropertyData) {
            debug("Invalid token:", tokenData);
            debug("From:", this.token);
            throw new Error("Invalid token");
        }

        const data = tokenData.payload.tokenPropertyData;
        const { clientId, userTkey } = data;
        const deviceId = data.deviceSerialNumber;

        return {
            clientId,
            deviceId,
            userTkey,
        };
    }

    public async getRefreshToken() {
        if (Date.now() < this.refreshTokenExpires) {
            debug("Reusing cached refreshToken");
            return this.refreshToken;
        }

        debug("Loading refresh refreshToken...");
        return this.loadRefreshToken();
    }

    private async fetchContent(urns: string[]) {
        return this.request("post", {
            body: urns.map(urn => ({ id: urn })),
            json: true,
            url: CONTENT_URL,
        });
    }

    private async request(method: "delete" | "get" | "post", opts: OptionsWithUrl) {
        return request[method](await this.fillRequest(opts));
    }

    private async fillRequest(opts: OptionsWithUrl) {
        const token = await this.getRefreshToken();
        return {
            headers: { Authorization: `Bearer ${token}`, ...HBO_HEADERS },
            ...opts,
        };
    }

    private async loadRefreshToken() {
        // NOTE: I'm not sure if this step is 100% necessary, but
        // it may help to ensure refreshed tokens....

        const {
            clientId,
            deviceId,
        } = await this.extractTokenInfo();

        // this step fetches some sort of session token that is *not*
        // logged in
        const baseTokens = await request.post({
            body: {
                client_id: clientId,
                client_secret: clientId,
                deviceSerialNumber: deviceId,
                grant_type: "client_credentials",
                scope: "browse video_playback_free",
            },
            headers: HBO_HEADERS,
            json: true,
            url: TOKENS_URL,
        });
        debug("baseTokens=", baseTokens);

        // now we exchange the session token above for an updated
        // refresh token
        const realTokens = await request.post({
            body: {
                grant_type: "refresh_token",
                refresh_token: this.token,
                scope: "browse video_playback device",
            },
            headers: { Authorization: `Bearer ${baseTokens.refresh_token}`, ...HBO_HEADERS },
            json: true,
            url: TOKENS_URL,
        });
        debug("Real Tokens:", realTokens);

        // make sure it worked
        if (!realTokens.isUserLoggedIn) {
            throw new Error("Not logged in...");
        }

        // cache this until expired (see: expires_in)
        this.refreshTokenExpires = Date.now() + realTokens.expires_in;
        this.refreshToken = realTokens.refresh_token;

        // update the token, if possible
        if (this.refreshToken) {
            await write(this.token, this.refreshToken);
        }

        return realTokens.refresh_token;
    }
}
