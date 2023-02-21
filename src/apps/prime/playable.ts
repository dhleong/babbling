import type { PrimeApp } from ".";
import { IPlayableOptions } from "../../app";
import { ITitleInfo } from "./api";

export function pickTitleIdFromUrl(url: string) {
    try {
        const obj = new URL(url);
        const gti = obj.searchParams.get("gti");
        if (gti != null) {
            return gti;
        }
    } catch {
        // Ignore and fall through
    }

    const m1 = url.match(/video\/detail\/([^/]+)/);
    if (m1) {
        return m1[1];
    }

    const m2 = url.match(/gp\/product\/([^/?]+)/);
    if (m2) {
        return m2[1];
    }

    const m3 = url.match(/dp\/([^/?]+)/);
    if (m3) {
        return m3[1];
    }
}

export function urlFor(item: { titleId: string }) {
    return `https://watch.amazon.com/detail?gti=${item.titleId}`;
}

export function playableFromTitleId(titleId: string) {
    return async (app: PrimeApp, _opts: IPlayableOptions) =>
        app.resumeSeriesByTitleId(titleId);
}

export function playableForMovieById(id: string) {
    return async (app: PrimeApp, opts: IPlayableOptions) => {
        if (opts.resume === false) {
            await app.play(id, { startTime: 0 });
        } else {
            await app.play(id, {});
        }
    };
}

export function playableFromTitleInfo(titleIdInfo: ITitleInfo) {
    if (titleIdInfo.series) {
        return playableFromTitleId(titleIdInfo.series.titleId);
    }
    if (titleIdInfo.movie) {
        return playableForMovieById(titleIdInfo.movie.titleId);
    }
}
