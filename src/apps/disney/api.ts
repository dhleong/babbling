import _debug from "debug";
const debug = _debug("babbling:DisneyApp:api");

import jwt from "jsonwebtoken";
import request from "request-promise-native";

import { read, write } from "../../token";

import { IDisneyOpts } from "./config";

const CLIENT_API_KEY_URL = "https://www.disneyplus.com/home";
const TOKEN_URL = "https://global.edge.bamgrid.com/token";

const GRAPHQL_URL_BASE = "https://search-api-disney.svcs.dssott.com/svc/search/v2/graphql/persisted/query/core/";
const SEARCH_KEY = "disneysearch";
const RESUME_SERIES_KEY = "ContinueWatchingSeries";

const MIN_TOKEN_VALIDITY_MS = 5 * 60_000;

export interface ISearchHit {
    images: Array<{
        purpose: string,
        url: string,
    }>;

    mediaRights: {
        downloadBlocked: true,
        rewind: true,
    };

    milestones: Array<{
        id: "95985aab-01a8-4ad0-948a-ed7c86b2a026",
        milestoneTime: Array<{
            startMillis: number,
            type: "offset",
        }>;
        milestoneType: "up_next",
    }>;

    texts: Array<{
        content: string,
        field: "description" | "title",
        language: string,
        sourceEntity: "series" | "program",
        targetEntity: "series" | "program",
        type: "brief" | "full" | "medium" | "slug" | "sort",
    }>;

    contentId: string;
    encodedSeriesId?: string;
    episodeNumber?: number;
    originalLanguage: string;
    programType: "movie";
    runtimeMillis: 5337000;
    seasonId?: string;
    seasonSequenceNumber?: number;
    seriesId?: string;
    videoId: string;
}

export class DisneyApi {

    private clientInfo?: { apiKey: string, id: string };

    constructor(
        private readonly options: IDisneyOpts,
    ) {}

    public async pickResumeEpisodeForSeries(seriesId: string) {
        const data = await this.request(RESUME_SERIES_KEY, {
            seriesId,
        });

        return data.resume as ISearchHit;
    }

    public async search(
        query: string,
    ) {
        debug(`search: ${query}`);

        const disneysearch = await this.request(SEARCH_KEY, {
            index: "disney_global",
            q: query,
        });

        return disneysearch.hits.map((obj: any) => obj.hit as ISearchHit) as ISearchHit[];
    }

    public async ensureTokensValid() {
        await this.ensureToken();
        const [ token, refreshToken ] = await Promise.all([
            read(this.options.token),
            read(this.options.refreshToken),
        ]);
        return { token, refreshToken };
    }

    private async ensureToken() {
        const token = read(this.options.token);

        const tokenData = jwt.decode(token) as any;
        if (!tokenData) {
            debug("Invalid token:", tokenData);
            debug("From:", this.options.token);
            throw new Error("Invalid token");
        }

        if (tokenData.exp * 1000 > Date.now() + MIN_TOKEN_VALIDITY_MS) {
            debug("access token is valid");
            return token;
        }

        debug("Refreshing access token...");

        const [clientInfo, refreshToken] = await Promise.all([
            this.getClientInfo(),
            read(this.options.refreshToken),
        ]);
        debug("got client=", clientInfo);

        const response = await request({
            form: {
                grant_type: "refresh_token",
                latitude: 0,
                longitude: 0,
                platform: "browser",
                refresh_token: refreshToken,
            },
            headers: {
                "authorization": `Bearer ${clientInfo.apiKey}`,
                "x-bamsdk-client-id": clientInfo.id,
                "x-bamsdk-platform": "macintosh",
                "x-bamsdk-version": "4.8",
            },
            json: true,
            method: "POST",
            url: TOKEN_URL,
        });

        const newToken = response.access_token;
        const newRefreshToken = response.refresh_token;

        if (typeof this.options.token === "string") {
            this.options.token = newToken;
            this.options.refreshToken = newRefreshToken;
        } else {
            debug("Persisting new tokens...");
            await Promise.all([
                write(this.options.token, newToken),
                write(this.options.refreshToken, newRefreshToken),
            ]);
        }

        return newToken;
    }

    private async getClientInfo() {
        const cached = this.clientInfo;
        if (cached) return cached;

        const html = await request({
            url: CLIENT_API_KEY_URL,
        });

        const apiKeyMatch = (html as string).match(/"clientApiKey":"([^"]+)/);
        if (!apiKeyMatch) throw new Error("Couldn't extract API key");

        const idMatch = (html as string).match(/"clientId":"(disney-[^"]+)"/);
        if (!idMatch) throw new Error("Couldn't extract client ID");

        const result = {
            apiKey: apiKeyMatch[1],
            id: idMatch[1],
        };

        this.clientInfo = result;

        return result;
    }

    private async request(
        graphQlKey: string,
        variablesMap: any,
    ) {
        const token = await this.ensureToken();

        const variables = JSON.stringify({
            preferredLanguage: ["en"],
            ...variablesMap,
        });

        const { data } = await request({
            headers: {
                Authorization: `Bearer ${token}`,
            },
            json: true,
            qs: {
                variables,
            },
            url: GRAPHQL_URL_BASE + graphQlKey,
        });

        return data[graphQlKey];
    }

}
