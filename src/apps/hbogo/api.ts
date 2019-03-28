/*

Fetch Markers (last watch indicators:)

   GET https://markers.api.hbo.com/markers/{id,...}?limit=N
   IE: comma-separated list
       N = number of items in the list

   Returns:

   [{"created": "2019-03-27T23:16:25Z",
     "cutId": "GVU3WpwOjOYNJjhsJAX5-",
     "id": "urn:hbo:episode:GVU3WpwOjOYNJjhsJAX5-",
     "position": 600,
     "runtime": 3910},
     ...
     ]

   Or, without the [] if limit=1

Query Markers:

   POST https://comet.api.hbo.com/content
   [{"id": "urn:hbo:series-markers:mine"}]

   Returns a list of Markers for a bunch of series,
   possibly suggesting the episode to continue for
   each series:

   [{"body": {
      "seriesMarkers": {
        "urn:hbo:series:<SERIES_ID>": {
          "focusEpisode": "urn:hbo:episode:<EP_ID>",
          "markerStatus": "<START|LATEST|CONTINUE|TOPICAL>",
        }
      }
    }}]

 */

import jwt from "jsonwebtoken";
import request, {OptionsWithUrl} from "request-promise-native";

import _debug from "debug";
const debug = _debug("babbling:hbogo:api");

const CONTENT_URL = "https://comet.api.hbo.com/content";
const TOKENS_URL = "https://comet.api.hbo.com/tokens";

export const HBO_HEADERS = {
    "Accept": "application/vnd.hbo.v9.full+json",
    // tslint:disable-next-line
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36",
    "X-Hbo-Client-Version": "Hadron/21.0.1.176 desktop (DESKTOP)",
};

export class HboGoApi {

    private refreshToken: string | undefined;
    private refreshTokenExpires = 0;

    constructor(
        private token: string,
    ) {}

    public async stopConcurrentStreams() {
        return this.request("delete", {
            url: "https://comet.api.hbo.com/concurrentStreams",
        });
    }

    public async fetchNextEpisodeForSeries(seriesUrn: string) {
        const markersResult = await this.fetchContent(["urn:hbo:series-markers:mine"]);
        const markersBySeries = markersResult[0].body.seriesMarkers;

        const seriesMarker = markersBySeries[seriesUrn];
        if (!seriesMarker) {
            // TODO we could fetch the series' episodes and pick the first
            throw new Error("No marker for series");
        }

        // NOTE: I'm not sure what to do with `markerStatus`...
        const { focusEpisode } = seriesMarker;
        const focusEpisodeUrn = focusEpisode as string;
        let episodeMarker;
        try {
            const episodeId = focusEpisodeUrn.substring(focusEpisodeUrn.lastIndexOf(":") + 1);
            episodeMarker = await this.request("get", {
                json: true,
                qs: {
                    limit: 1,
                },
                url: `https://markers.api.hbo.com/markers/${episodeId}`,
            });

            debug("Loaded marker for", focusEpisode, ":", episodeMarker);
        } catch (e) {
            // no marker, probably
            debug("Error fetching marker for", focusEpisode, ":", e);
        }

        const result = {
            position: undefined,
            urn: focusEpisodeUrn,
        };

        if (episodeMarker && episodeMarker.position) {
            result.position = episodeMarker.position;
        }

        return result;
    }

    public extractTokenInfo() {
        const tokenData = jwt.decode(this.token) as any;
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
            body: urns.map(urn => ({id: urn})),
            json: true,
            url: CONTENT_URL,
        });
    }

    private async request(method: "delete" | "get" | "post", opts: OptionsWithUrl) {
        return request[method](await this.fillRequest(opts));
    }

    private async fillRequest(opts: OptionsWithUrl) {
        const token = await this.getRefreshToken();
        return Object.assign({
            headers: Object.assign(HBO_HEADERS, {
                Authorization: `Bearer ${token}`,
            }),
        }, opts);
    }

    private async loadRefreshToken() {
        // NOTE: I'm not sure if this step is 100% necessary, but
        // it may help to ensure refreshed tokens....

        const {
            clientId,
            deviceId,
        } = this.extractTokenInfo();

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
            headers: Object.assign(HBO_HEADERS, {
                Authorization: `Bearer ${baseTokens.refresh_token}`,
            }),
            json: true,
            url: TOKENS_URL,
        });
        debug("Real Tokens:", realTokens);

        // make sure it worked
        if (!realTokens.isUserLoggedIn) {
            throw new Error("Not logged in...");
        }

        // cache this until expired (see: expires_in)
        // TODO store this?
        this.refreshTokenExpires = Date.now() + realTokens.expires_in;
        this.refreshToken = realTokens.refresh_token;

        return realTokens.refresh_token;
    }

}
