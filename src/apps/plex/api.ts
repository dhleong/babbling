import request from "request-promise-native";

import { read, Token } from "../../token";
import Expirable from "../../util/expirable";

const API_BASE = "https://plex.tv";

const SERVERS_CACHE_DURATION_SECONDS = 3600;

interface IPlexServer {
    uri: string;
    accessToken: string;
    clientIdentifier: string;
    name: string;
    sourceTitle: string;
}

export class PlexApi {
    private servers = new Expirable<IPlexServer[]>(() => this.fetchServers());

    constructor(
        private readonly token: Token,
        private readonly clientIdentifier: string,
    ) {}

    public getServers() {
        return this.servers.get();
    }

    private async fetchServers() {
        const resources = await request.get(`${API_BASE}/api/v2/resources`, {
            json: true,
            qs: {
                includeHttps: 1,
            },
            headers: {
                "x-plex-token": read(this.token),
                "x-plex-client-identifier": this.clientIdentifier,
            },
        });

        const value = resources
            .filter((resource: any) => resource.provides.includes("server"))
            .map((resource: any) => {
                const publicConnection = resource
                    .connections
                    .filter((connection: any) => connection.address === resource.publicAddress)[0];

                const server: IPlexServer = {
                    accessToken: resource.accessToken,
                    clientIdentifier: resource.clientIdentifier,
                    name: resource.name,
                    sourceTitle: resource.sourceTitle,
                    uri: (publicConnection ?? resource.connections[0]).uri,
                };
                return server;
            });
        return { value, expiresInSeconds: SERVERS_CACHE_DURATION_SECONDS };
    }
}
