import createDebug from "debug";

const debug = createDebug("babbling:plex:model");

export interface IPlexServer {
    uri: string;
    accessToken: string;
    clientIdentifier: string;
    name: string;
    sourceTitle: string;
    version: string;
}

export interface IPlexUser {
    id: number;
    username: string;
    subscription: {
        active: boolean;
    };
}

export interface IPlexItem {
    desc?: string;
    uri: string;
    title: string;
    seriesTitle?: string;
    lastViewedAt: number;
    thumb: string;
    type: "episode";
}

function buildThumbUrl(server: IPlexServer, path: string) {
    const url = new URL(server.uri + "/photo/:/transcode");
    url.searchParams.set("url", path);
    url.searchParams.set("X-Plex-Token", server.accessToken);
    url.searchParams.set("height", "1280");
    url.searchParams.set("width", "1280");
    return url.toString();
}

export function parseItemMetadata(
    server: IPlexServer,
    metadata: Record<string, any>,
    { resolveRoot }: { resolveRoot?: boolean } = {},
): IPlexItem {
    // NOTE: We use grandparentKey etc if available to canonicalize to the series' ID
    // (unless resolveRoot is false!)
    const key =
        resolveRoot !== false
            ? metadata.grandparentKey ?? metadata.parentKey ?? metadata.key
            : metadata.key;

    const uri =
        `https://app.plex.tv/desktop/#!/server/${server.clientIdentifier}/details?` +
        new URLSearchParams({ key: key.replace(/\/children$/, "") }).toString();

    return {
        desc: metadata.summary,
        lastViewedAt: metadata.lastViewedAt,
        thumb: buildThumbUrl(
            server,
            metadata.grandparentArt ?? metadata.parentArt ?? metadata.art,
        ),
        title: metadata.title,
        seriesTitle: metadata.grandparentTitle ?? metadata.parentTitle,
        type: metadata.type,
        // uri: server.uri.replace("http", "plex") + key.replace(/\/children$/, ""),
        uri: uri.toString(),
    };
}

export function extractMediaKeyFromUri(uri: string) {
    const searchParamsStart = uri.indexOf("?");
    if (searchParamsStart === -1) {
        throw new Error("Invalid media URI; no search params");
    }

    const rawParams = uri.substring(searchParamsStart + 1);
    const params = new URLSearchParams(rawParams);
    const contentId = params.get("key");
    if (contentId == null) {
        debug(params);
        throw new Error("Invalid media URI; no key");
    }
    return contentId;
}
