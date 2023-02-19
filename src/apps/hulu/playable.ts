import { HuluApp } from ".";
import { IPlayable } from "../../app";

export function createUrl(type: string, id: string) {
    return `https://www.hulu.com/${type}/${id}`;
}

export function pickArtwork(item: any) {
    const artwork = item.artwork ?? item.visuals?.artwork;
    if (artwork == null) {
        return;
    }

    const container =
        artwork["program.tile"] ??
        artwork.horizontal?.image ??
        artwork["video.horizontal.hero"];

    const path = container?.path;
    if (path == null) {
        return;
    }

    return `${path}&operations=${encodeURIComponent(
        JSON.stringify([{ resize: "600x600|max" }, { format: "jpeg" }]),
    )}`;
}

export function playableForVideoId(id: string): IPlayable<HuluApp> {
    return (app: HuluApp) => app.play(id, {});
}

export function playableForSeries(id: string): IPlayable<HuluApp> {
    return (app: HuluApp) => app.resumeSeries(id);
}

export function createPlayable({
    id,
    type,
}: {
    id: string;
    type: string;
}): IPlayable<HuluApp> {
    if (type === "series") {
        return playableForSeries(id);
    }

    return playableForVideoId(id);
}
