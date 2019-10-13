import _debug from "debug";
const debug = _debug("babbling:PrimeApp:player");

import { ChakramApi, ContentType, IBaseObj, ISeason } from "chakram-ts";

import { IPlayableOptions, IPlayerChannel, IQueryResult } from "../../app";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import { IPrimeOpts, PrimeApp } from ".";

export class PrimePlayerChannel implements IPlayerChannel<PrimeApp> {

    public ownsUrl(url: string): boolean {
        throw new Error("Method not implemented.");
    }

    public async createPlayable(url: string, options: IPrimeOpts) {
        const titleId = pickTitleIdFromUrl(url);
        if (!titleId) {
            throw new Error(`Unsure how to play ${url}`);
        }

        const api = new ChakramApi(options.cookies);
        const info = await api.getTitleInfo(titleId);
        debug("titleInfo = ", info);

        return playableFromObj(info);
    }

    public async *queryByTitle(
        title: string,
        opts: IPrimeOpts,
    ): AsyncIterable<IQueryResult> {
        const api = new ChakramApi(opts.cookies);
        for (const result of await api.search(title)) {
            yield {
                appName: "PrimeApp",
                playable: playableFromObj(result),
                title: cleanTitle(result.title),
                url: "https://www.amazon.com/video/detail/" + result.id,
            };
        }
    }

}

function pickTitleIdFromUrl(url: string) {
    const m1 = url.match(/video\/detail\/([^\/]+)/);
    if (m1) {
        return m1[1];
    }

    const m2 = url.match(/gp\/product\/([^\/\?]+)/);
    if (m2) {
        return m2[1];
    }
}

function cleanTitle(original: string) {
    // including this suffix confuses title-matching
    return original.replace("(4K UHD)", "").trim();
}

function playableFromObj(info: IBaseObj) {
    if (info.type === ContentType.SERIES) {
        debug("playable for series", info.id);
        return async (app: PrimeApp) => app.resumeSeries(info.id);
    } else if (info.type === ContentType.SEASON) {
        // probably they want to resume the series
        const season = info as ISeason;
        if (season.series) {
            const seriesId = season.series.id;
            debug("playable for series", seriesId, "given season", seriesId);
            return async (app: PrimeApp) => app.resumeSeries(seriesId);
        }
    }

    debug("playable for title", info.id);
    return async (app: PrimeApp, opts: IPlayableOptions) => {
        if (opts.resume === false) {
            await app.play(info.id, { startTime: 0 });
        } else {
            await app.play(info.id, {});
        }
    };
}
