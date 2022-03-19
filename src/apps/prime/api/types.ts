export interface IEpisode {
    episodeNumber: number;
    seasonId: string;
    seasonNumber: number;
    title: string;
    titleId: string;

    completedAfter: number;
    runtimeSeconds: number;
    watchedSeconds: number;
}

export interface IWatchNextItem {
    title: string;
    titleId: string;

    completedAfter: number;
    resumeTitleId?: string;
    runtimeSeconds: number;
    watchedSeconds: number;
}
