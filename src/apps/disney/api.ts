import _debug from "debug";
const debug = _debug("babbling:DisneyApp:api");

import request from "request-promise-native";

import { read/* , Token, write*/ } from "../../token";

import { IDisneyOpts } from "./config";

const GRAPHQL_URL_BASE = "https://search-api-disney.svcs.dssott.com/svc/search/v2/graphql/persisted/query/core/";
const SEARCH_KEY = "disneysearch";
const RESUME_SERIES_KEY = "ContinueWatchingSeries";

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
        // TODO refresh if necessary?
        return read(this.options.token);
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
