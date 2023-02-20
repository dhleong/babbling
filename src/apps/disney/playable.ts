import { IQueryResult } from "../../app";

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
