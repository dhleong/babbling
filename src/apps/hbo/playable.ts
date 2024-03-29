import createDebug from "debug";

import type { HboApp } from ".";
import { IQueryResult } from "../../app";
import { entityTypeFromUrn, HboApi, unpackUrn } from "./api";

const debug = createDebug("babbling:hbo:playable");

function normalizeUrn(urn: string) {
    const unpacked = unpackUrn(urn);
    if (unpacked.type === "page") {
        return `urn:hbo:${unpacked.pageType}:${unpacked.id}`;
    }
    return urn;
}

export function urnFromUrl(url: string) {
    const pathIndex = url.lastIndexOf("/");
    if (pathIndex === 0) {
        // This is *just* a URN
        return normalizeUrn(url);
    }
    return normalizeUrn(url.substring(pathIndex + 1));
}

export function urnFromQueryResult(item: IQueryResult) {
    if (item.appName !== "HboApp") {
        throw new Error("Given QueryResult for wrong app");
    } else if (item.url == null) {
        throw new Error(`Given query result has no URL: ${item.title}`);
    }

    return urnFromUrl(item.url);
}

export async function createPlayableFromUrn(api: HboApi, urn: string) {
    try {
        switch (entityTypeFromUrn(urn)) {
            case "franchise":
                // Is this always correct?
                const seriesUrn = await api.resolveFranchiseSeries(urn);
                return async (app: HboApp) => {
                    debug("Resume franchise series @", urn);
                    return app.resumeSeries(seriesUrn);
                };

            case "series":
                return async (app: HboApp) => {
                    debug("Resume series @", urn);
                    return app.resumeSeries(urn);
                };

            case "episode":
            case "extra":
            case "feature":
            case "season":
            default:
                // TODO: it may be possible to resume specific episodes or
                // features (movies)...
                return async (app: HboApp) => app.play(urn);
        }
    } catch (e) {
        throw new Error(`'${urn}' doesn't look playable`);
    }
}

const COVER_IMAGE_TEMPLATE_VALUES: Partial<Record<string, string>> = {
    compression: "medium",
    size: "1920x1080",
    protection: "false",
    scaleDownToFit: "false",
};

export function formatCoverImage(template: string | undefined) {
    if (template == null) {
        return undefined;
    }

    // eg: tile: "https://art-gallery.api.hbo.com/images/<id>/tile?v=<v>&size={{size}}&compression={{compression}}&protection={{protection}}&scaleDownToFit={{scaleDownToFit}}&productCode=hboMax&overlayImage=urn:warnermedia:brand:not-in-a-hub:territory:adria"
    return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
        const value = COVER_IMAGE_TEMPLATE_VALUES[key];
        if (value == null) {
            debug("Unexpected cover image template key", key);
        }
        return value ?? "";
    });
}
