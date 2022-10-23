import createDebug from "debug";

import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
} from "../../app";
import { EpisodeResolver } from "../../util/episode-resolver";

import type { HboApp, IHboOpts } from ".";
import { entityTypeFromUrn, HboApi, IHboResult, unpackUrn } from "./api";

const debug = createDebug("babbling:hbo:channel");

const COVER_IMAGE_TEMPLATE_VALUES: Partial<Record<string, string>> = {
    compression: "medium",
    size: "1920x1080",
    protection: "false",
    scaleDownToFit: "false",
};

function formatCoverImage(template: string) {
    // eg: tile: "https://art-gallery.api.hbo.com/images/<id>/tile?v=<v>&size={{size}}&compression={{compression}}&protection={{protection}}&scaleDownToFit={{scaleDownToFit}}&productCode=hboMax&overlayImage=urn:warnermedia:brand:not-in-a-hub:territory:adria"
    return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
        const value = COVER_IMAGE_TEMPLATE_VALUES[key];
        if (value == null) {
            debug("Unexpected cover image template key", key);
        }
        return value ?? "";
    });
}

function normalizeUrn(urn: string) {
    const unpacked = unpackUrn(urn);
    if (unpacked.type === "page") {
        return `urn:hbo:${unpacked.pageType}:${unpacked.id}`;
    }
    return urn;
}

function urnFromUrl(url: string) {
    const pathIndex = url.lastIndexOf("/");
    if (pathIndex === 0) {
        // This is *just* a URN
        return normalizeUrn(url);
    }
    return normalizeUrn(url.substring(pathIndex + 1));
}

export class HboPlayerChannel implements IPlayerChannel<HboApp> {
    private api: HboApi;

    constructor(
        private readonly options: IHboOpts,
    ) {
        this.api = new HboApi(this.options.token);
    }

    public ownsUrl(url: string) {
        return url.includes("play.hbomax.com") || url.startsWith("urn:hbo:");
    }

    public async createPlayable(url: string) {
        const urn = urnFromUrl(url);

        try {
            switch (entityTypeFromUrn(urn)) {
                case "franchise":
                    // Is this always correct?
                    const seriesUrn = await this.api.resolveFranchiseSeries(urn);
                    return async (app: HboApp) => {
                        debug("Resume franchise series @", url);
                        return app.resumeSeries(seriesUrn);
                    };

                case "series":
                    return async (app: HboApp) => {
                        debug("Resume series @", url);
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

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        if (item.appName !== "HboApp") {
            throw new Error("Given QueryResult for wrong app");
        } else if (item.url == null) {
            throw new Error(`Given query result has no URL: ${item.title}`);
        }

        const urn = urnFromUrl(item.url);
        if (entityTypeFromUrn(urn) !== "series") return; // cannot have it

        const resolver = new EpisodeResolver({
            container: () => this.api.getEpisodesForSeries(urn),
        });
        const episode = await resolver.query(query);
        if (!episode) return;

        const url = `https://play.hbomax.com/${episode.urn}`;
        return {
            appName: "HboApp",
            playable: await this.createPlayable(url),
            seriesTitle: item.title,
            title: episode.title,
            url,
        };
    }

    public async* queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        for await (const item of this.api.search(title)) {
            if (item.type === "SERIES_EPISODE") {
                // Don't emit episodes; this method is for
                // finding series and movies only
                continue;
            }

            yield await this.hboToQueryResult(item);
        }
    }

    public async* queryRecommended() {
        // NOTE: HBO actually has a "recommended," but the other apps are returning
        // "continue watching" content here, so until we update the API to have that
        // as a distinct method, let's stay internally consistent
        yield *this.yieldPlayables(this.api.queryContinueWatching());
    }

    private async* yieldPlayables(source: ReturnType<typeof this.api.search>) {
        for await (const result of source) {
            yield await this.hboToQueryResult(result);
        }
    }

    private async hboToQueryResult(source: IHboResult): Promise<IQueryResult> {
        // HBO Max may use a slightly different URN structure for the
        // series / movie page than it emits in the search result
        const urn = unpackUrn(source.seriesUrn ?? source.urn);
        const url = urn.pageType != null
            ? `https://play.hbomax.com/${source.urn}`
            : `https://play.hbomax.com/page/urn:hbo:page:${urn.id}:type:${urn.type}`;
        const title = source.seriesTitle ?? source.title;

        return {
            appName: "HboApp",
            cover: source.imageTemplate == null ? undefined : formatCoverImage(source.imageTemplate),
            playable: await this.createPlayable(url),
            title,
            url,
        };
    }
}
