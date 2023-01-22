export interface IPlexServer {
    uri: string;
    accessToken: string;
    clientIdentifier: string;
    name: string;
    sourceTitle: string;
    version: string;
}

export interface IPlexItem {
    uri: string;
    title: string;
    seriesTitle?: string;
    lastViewedAt: number;
    thumb: string;
    type: "episode";
}

function buildThumbUrl(server: IPlexServer, path: string) {
    const url = new URL(server.uri +  "/photo/:/transcode");
    url.searchParams.set("url", path);
    url.searchParams.set("X-Plex-Token", server.accessToken);
    url.searchParams.set("height", "1280");
    url.searchParams.set("width", "1280");
    return url.toString();
}

export function parseItemMetadata(server: IPlexServer, metadata: Record<string, any>): IPlexItem {
    return {
        lastViewedAt: metadata.lastViewedAt,
        thumb: buildThumbUrl(server, metadata.grandparentArt ?? metadata.parentArt ?? metadata.art),
        title: metadata.title,
        seriesTitle: metadata.grandparentTitle,
        type: metadata.type,
        uri: server.uri.replace("http", "plex") + metadata.key,
    };
}
