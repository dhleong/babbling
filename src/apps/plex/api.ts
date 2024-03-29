import _debug from "debug";
import request from "request-promise-native";

import { read, Token } from "../../token";
import Expirable from "../../util/expirable";
import {
    extractMediaKeyFromUri,
    IPlexServer,
    IPlexUser,
    parseItemMetadata,
} from "./model";

const debug = _debug("babbling:plex");

const API_BASE = "https://plex.tv/api/v2";

const SERVERS_CACHE_DURATION_SECONDS = 3600;

export class PlexApi {
    private servers = new Expirable<IPlexServer[]>(() => this.fetchServers());

    constructor(
        private readonly token: Token,
        private readonly clientIdentifier: string,
    ) {}

    public getServers() {
        return this.servers.get();
    }

    public async getUser() {
        return this.apiGet<IPlexUser>("/user");
    }

    public async getServerForUri(uri: string) {
        const url = new URL(uri);
        const match = url.hash.match(/server\/([^/]+)/);
        if (match == null || match.length < 2) {
            throw new Error("Invalid media URI; no server identifier");
        }
        const machineIdentifier = match[1];

        const servers = await this.getServers();
        for (const server of servers) {
            if (server.clientIdentifier === machineIdentifier) {
                return server;
            }
        }

        debug("Looking for", machineIdentifier);
        throw new Error(`Unknown server for uri: ${uri}`);
    }

    public getContinueWatching() {
        return this.queryMedia("/hubs/continueWatching");
    }

    public async getApiItemsByUri(uri: string) {
        const server = await this.getServerForUri(uri);
        const contentId = extractMediaKeyFromUri(uri);

        const response = await request.get(server.uri + contentId, {
            json: true,
            qs: {
                includeOnDeck: 1,
            },
            headers: this.serverRequestHeaders(server),
        });
        return { server, items: response.MediaContainer.Metadata as any[] };
    }

    public async getApiItemByUri(uri: string) {
        const { server, items } = await this.getApiItemsByUri(uri);
        return { server, item: items[0] };
    }

    public async resolveOnDeckForUri(uri: string) {
        const { server, item } = await this.getApiItemByUri(uri);

        return parseItemMetadata(server, item.OnDeck.Metadata, {
            resolveRoot: false,
        });
    }

    public search(title: string) {
        return this.queryMedia("/hubs/search", {
            filterHub(hub) {
                return hub.type === "show" || hub.type === "movie";
            },
            qs: {
                query: title,
            },
        });
    }

    /**
     * NOTE: `item` should look like eg `/library/metadata/1234`
     */
    public async createPlayQueue(server: IPlexServer, item: string) {
        const response = await request.post(server.uri + "/playQueues", {
            json: true,
            qs: {
                continuous: 1,
                includeChapters: 1,
                includeRelated: 0,
                repeat: 0,
                shuffle: 0,
                type: "video",
                uri: `server://${server.clientIdentifier}/library${item}`,
            },
            headers: this.serverRequestHeaders(server),
        });
        debug("play queue:", response.MediaContainer);

        return {
            playQueueID: response.MediaContainer.playQueueID,
            selectedItemID: response.MediaContainer.playQueueSelectedItemID,
            selectedItemOffset:
                response.MediaContainer.playQueueSelectedItemOffset,
        };
    }

    private async queryMedia(
        path: string,
        {
            qs,
            filterHub,
        }: {
            filterHub?: (hub: { type: string }) => boolean;
            qs?: Record<string, string>;
        } = {},
    ) {
        const servers = await this.getServers();
        const requests = await Promise.allSettled(
            servers.map(async (server) => {
                const response = await request.get(server.uri + path, {
                    json: true,
                    qs,
                    headers: this.serverRequestHeaders(server),
                });
                return [server, response] as const;
            }),
        );

        const items = requests.flatMap((result) => {
            if (result.status !== "fulfilled") {
                return [];
            }

            const [server, response] = result.value;

            let hubs = response.MediaContainer.Hub;
            if (filterHub != null) {
                hubs = hubs.filter(filterHub);
            }

            return hubs.flatMap((hub: any) => {
                return (
                    hub.Metadata?.map((metadata: any) => [server, metadata]) ??
                    []
                );
            });
        });

        return items
            .map(([server, metadata]) => parseItemMetadata(server, metadata))
            .sort((a, b) => b.lastViewedAt - a.lastViewedAt);
    }

    private async fetchServers() {
        const resources = await this.apiGet<any>("/resources", {
            qs: {
                includeHttps: 1,
            },
        });

        const value = resources
            .filter((resource: any) => resource.provides.includes("server"))
            .map((resource: any) => {
                const publicConnection = resource.connections.filter(
                    (connection: any) =>
                        connection.address === resource.publicAddress,
                )[0];

                debug("found server:", resource);
                const server: IPlexServer = {
                    accessToken: resource.accessToken,
                    clientIdentifier: resource.clientIdentifier,
                    name: resource.name,
                    sourceTitle: resource.sourceTitle,
                    uri: (publicConnection ?? resource.connections[0]).uri,
                    version: resource.productVersion,
                };
                return server;
            });
        return { value, expiresInSeconds: SERVERS_CACHE_DURATION_SECONDS };
    }

    private async apiGet<R>(
        path: string,
        { qs }: { qs?: Record<string, unknown> } = {},
    ): Promise<R> {
        const response = await request.get(`${API_BASE}${path}`, {
            json: true,
            qs,
            headers: {
                "x-plex-token": read(this.token),
                "x-plex-client-identifier": this.clientIdentifier,
            },
        });

        return response as R;
    }

    private serverRequestHeaders(server: IPlexServer) {
        return {
            "x-plex-token": server.accessToken,
            "x-plex-client-identifier": this.clientIdentifier,
        };
    }
}
