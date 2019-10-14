import { IVideo } from "youtubish/dist/model";

export function filterFromSkippedIds(
    ids: string | string[] | undefined,
) {
    if (!ids || !ids.length) return;

    if (typeof ids === "string") {
        return (video: IVideo) => video.id !== ids;
    }

    return (video: IVideo) => {
        for (const id of ids) {
            if (id === video.id) return false;
        }

        return true;
    };
}
