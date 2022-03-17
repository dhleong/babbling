// tslint:disable no-bitwise
export enum SenderCapabilities {
    None = 0,

    DeferredInfo = 1 << 1,

    QueueNext = 1 << 2,
    QueuePrev = 1 << 3,
}
// tslint:enable no-bitwise

export interface IMediaMetadata {
    title: string;
    images?: string[];
    seriesTitle?: string;
}

export enum MetadataType {
    Generic,
    Movie,
    TvShow,
}

export interface IChromecastMetadata {
    metadataType: MetadataType;
    title: string;
    images?: Array<{ url: string }>;
}

export interface ITvShowChromecastMetadata extends IChromecastMetadata {
    episode?: number;
    season?: number;
    seriesTitle?: string;
}

export interface IMovieChromecastMetadata extends IChromecastMetadata {
    subtitle?: string;
}
