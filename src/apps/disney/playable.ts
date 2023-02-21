import { DisneyApp } from ".";
import { IPlayableOptions, IQueryResult } from "../../app";

const PLAYBACK_URL = "https://www.disneyplus.com/video/";

export function getSeriesIdFromUrl(url: string) {
    const m = url.match(/\/series\/[^/]+\/(.+)$/);
    if (m) return m[1];
}

export function getMovieIdFromUrl(url: string) {
    const m = url.match(/\/movies\/[^/]+\/(.+)$/);
    if (m) return m[1];
}

export function unpackSeriesFromResult(result: IQueryResult) {
    if (result.appName !== "DisneyApp") {
        throw new Error("Given QueryResult for wrong app");
    }

    const { url } = result;
    if (url == null) {
        throw new Error(`No url on query result: ${result.title}`);
    }

    return getSeriesIdFromUrl(url);
}

export function createVideoPlaybackUrl(videoId: string) {
    return PLAYBACK_URL + videoId;
}

export function createPlayableFromUrl(url: string) {
    // other urls?
    const videoMatch = url.match(/\/video\/(.+)$/);
    if (videoMatch && videoMatch[1]) {
        const id = videoMatch[1];

        return async (app: DisneyApp, _opts: IPlayableOptions) => {
            await app.playById(id);
        };
    }

    const seriesId = getSeriesIdFromUrl(url);
    if (seriesId) {
        return async (app: DisneyApp, opts: IPlayableOptions) =>
            app.playSeriesById(seriesId, opts);
    }

    const movieId = getMovieIdFromUrl(url);
    if (movieId) {
        return async (app: DisneyApp, opts: IPlayableOptions) =>
            app.playByFamilyId(movieId, opts);
    }

    throw new Error(`Unsure how to play ${url}`);
}
