import _debug from "debug";

import request from "request-promise-native";

import { read, write } from "../../token";
import { EpisodeResolver } from "../../util/episode-resolver";

import { IDisneyOpts } from "./config";

const debug = _debug("babbling:DisneyApp:api");

const CLIENT_API_KEY_URL = "https://www.disneyplus.com/home";
const TOKEN_URL = "https://global.edge.bamgrid.com/token";

const GRAPHQL_URL_BASE = "https://disney.content.edge.bamgrid.com/svc/";
const SEARCH_KEY = "search/disney";
const RESUME_SERIES_KEY = "ContinueWatchingSeries";

const MIN_TOKEN_VALIDITY_MS = 5 * 60_000;

/** `program` is used for eg movies, or episodes in a show */
export type SearchEntityType = "program" | "series";

export interface ISearchHit {
    images: Array<{
        purpose: string;
        url: string;
    }>;

    mediaRights: {
        downloadBlocked: true;
        rewind: true;
    };

    milestones: Array<{
        id: "95985aab-01a8-4ad0-948a-ed7c86b2a026";
        milestoneTime: Array<{
            startMillis: number;
            type: "offset";
        }>;
        milestoneType:
            | "up_next"
            | "intro_start"
            | "intro_end"
            | "recap_start"
            | "recap_end";
    }>;

    // Yeah, this got weird:
    text: Partial<
        Record<
            "title" | "description",
            Record<
                "full" | "slug",
                {
                    [key in SearchEntityType]: {
                        default: {
                            content: string;
                            language: string;
                            sourceEntity: key;
                        };
                    };
                }
            >
        >
    >;

    family?: {
        encodedFamilyId: string;
    };

    contentId: string;
    encodedSeriesId?: string;
    episodeNumber?: number;
    episodeSequenceNumber?: number;
    originalLanguage: string;
    programType: "movie";
    runtimeMillis: 5337000;
    seasonId?: string;
    seasonSequenceNumber?: number;
    seriesId?: string;
    type: "DmcVideo" | "DmcSeries" | "StandardCollection";
    videoId: string;
}

export interface IDisneyEpisode extends ISearchHit {
    indexInSeason: number;
    season: number;
}

export interface ICollection {
    meta: { hits: number; offset: number; page_size: number };
    id: string;
    items?: ISearchHit[];
    title: string;
    type:
        | "BecauseYouSet"
        | "ContinueWatchingSet"
        | "CuratedSet"
        | "RecommendationSet"; // others?
}

export class DisneyApi {
    private clientInfo?: { apiKey: string; id: string };
    private tokenExpiresAt = 0;

    constructor(private readonly options: IDisneyOpts) {}

    public async getResumeForFamilyId(familyId: string) {
        const data = await this.request("ContinueWatchingVideo", {
            familyId,
        });

        if (data.resume && data.resume.userMeta) {
            debug("resume with =", data.resume);
            return {
                contentId: data.resume.contentId as string,
                startTime: data.resume.userMeta.playhead as number,
            };
        }

        return {
            contentId: data.labels.watchlistLabel.contentId as string,
        };
    }

    public async pickResumeEpisodeForSeries(seriesId: string) {
        const data = await this.request(RESUME_SERIES_KEY, {
            seriesId,
        });

        const episode = data.resume as ISearchHit | null;
        if (!episode) {
            debug("No episode to resume: ", data);
            return;
        }

        let startTime: number | undefined;
        if (data.episodesWithProgress) {
            debug("episodesWithProgress = ", data.episodesWithProgress);
            const info = data.episodesWithProgress.find(
                (progress: any) => progress.contentId === episode.contentId,
            );
            if (info && info.userMeta) {
                debug("resume with info=", info);
                startTime = info.userMeta.playhead; // playhead is in seconds
            }
        }

        return {
            startTime,
            episode,
        };
    }

    /**
     * Typically, a more convenient method than [pickResumeEpisodeForSeries]
     * when you just want *some* episode. If there's nothing to resume, this
     * will find the first episode of the series
     */
    public async pickEpisodeForSeries(seriesId: string) {
        const [episodes, resume] = await Promise.all([
            this.getSeriesEpisodes(seriesId),
            this.pickResumeEpisodeForSeries(seriesId),
        ]);
        if (resume) return resume;

        const episode = await episodes.query({
            seasonIndex: 0,
            episodeIndex: 0,
        });
        if (!episode) {
            debug("Could not find episode of series ", seriesId);
            return;
        }

        return {
            episode,
            startTime: undefined,
        };
    }

    public async search(query: string) {
        debug(`search: ${query}`);

        const disneysearch = await this.request(SEARCH_KEY, {
            queryType: "ge",
            pageSize: "30",
            query,
        });

        debug(
            "search hits=",
            debug.enabled
                ? JSON.stringify(disneysearch.hits, null, 2)
                : disneysearch.hits,
        );
        return disneysearch.hits.map(
            (obj: any) => obj.hit as ISearchHit,
        ) as ISearchHit[];
    }

    public async getCollections() {
        const { containers } = await this.request("CollectionBySlug", {
            contentClass: "home",
            slug: "home",
        });

        const collections: ICollection[] = containers
            // NOTE: these are usually links to eg Marvel collection
            .filter((container: any) => container.set.contentClass !== "brand")
            .map((container: any) => {
                const { set } = container;
                const c: ICollection = {
                    id: set.refId,
                    items: set.items,
                    meta: set.meta,
                    title: set.texts[0].content,
                    type: set.refType,
                };

                if (!c.id && set.setId) {
                    c.id = set.setId;
                    c.type = set.type;
                }

                return c;
            });

        return collections;
    }

    public async loadCollection(collection: ICollection) {
        if (collection.items && collection.items.length) {
            debug(`collection ${collection.title} was embedded`);
            return collection.items;
        }

        debug(`loading collection ${collection.title}...`);
        const { items } = await this.request("SetBySetId", {
            setId: collection.id,
            setType: collection.type,
        });

        return items;
    }

    public async getSeriesSeasons(encodedSeriesId: string) {
        const response = await this.request("DmcSeriesBundle", {
            episodePageSize: 12,
            seriesId: encodedSeriesId,
        });
        const { seasons } = response.seasons;

        debug("loaded seasons for", encodedSeriesId, " = ", seasons);
        return seasons;
    }

    public async getSeriesEpisodes(encodedSeriesId: string) {
        const seasons = await this.getSeriesSeasons(encodedSeriesId);

        const api = this; // eslint-disable-line @typescript-eslint/no-this-alias
        return new EpisodeResolver<IDisneyEpisode>({
            async *episodesInSeason(seasonIndex: number) {
                yield* api.getSeasonEpisodeBatchesById(
                    seasons[seasonIndex].seasonId,
                );
            },
        });
    }

    public async ensureTokensValid() {
        await this.ensureToken();
        const [token, refreshToken] = await Promise.all([
            read(this.options.token),
            read(this.options.refreshToken),
        ]);
        return { token, refreshToken };
    }

    private async *getSeasonEpisodeBatchesById(seasonId: string) {
        const episodePageSize = 25; // can we bump this?
        let episodePage = 0;

        while (true) {
            const { meta, videos } = await this.request("DmcEpisodes", {
                episodePage,
                episodePageSize,
                seasonId: [seasonId],
            });

            const results: IDisneyEpisode[] = [];
            for (const video of videos as ISearchHit[]) {
                if (video.episodeSequenceNumber === undefined) continue;
                if (video.seasonSequenceNumber === undefined) continue;

                results.push({
                    ...video,

                    indexInSeason: video.episodeSequenceNumber,
                    season: video.seasonSequenceNumber,
                });
            }
            if (!results.length) break;

            yield results;

            if (!meta) break;
            if (videos.length < meta.episode_page_size) break;

            episodePage++;
        }
    }

    private async ensureToken() {
        const token = read(this.options.token);

        // NOTE: Disney switched to using JWE instead of JWT, so we can't
        // read the expiration directly from the token...
        if (this.tokenExpiresAt > Date.now() + MIN_TOKEN_VALIDITY_MS) {
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
                authorization: `Bearer ${clientInfo.apiKey}`,
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
        this.tokenExpiresAt = Date.now() + response.expires_in * 1000;

        if (typeof this.options.token === "string") {
            debug("Updating tokens...");
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
        variablesMap: Record<string, unknown>,
    ) {
        const token = await this.ensureToken();

        const variables = {
            version: "5.1",
            region: "US",
            audience: "k-false,l-true",
            maturity: "1830", // ?
            language: "en",
            ...variablesMap,
        };

        const prefixEndIdx = graphQlKey.indexOf("/");
        const isPrefixed = prefixEndIdx !== -1;
        let url =
            GRAPHQL_URL_BASE +
            (isPrefixed ? graphQlKey : `content/${graphQlKey}`);

        const dataKey = isPrefixed
            ? graphQlKey.substring(0, prefixEndIdx)
            : graphQlKey;

        for (const [k, v] of Object.entries(variables)) {
            url += "/" + k + "/" + encodeURIComponent(v);
        }

        try {
            const { data } = await request({
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                json: true,
                url,
            });

            return data[dataKey];
        } catch (e) {
            throw new Error(`Error @ ${url}:\n` + e);
        }
    }
}
