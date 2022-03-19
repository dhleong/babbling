import { ContentType } from "chakram-ts";

export enum AvailabilityType {
    FREE_WITH_ADS,
    OTHER_SUBSCRIPTION,
    OWNED,
    PRIME,

    PURCHASABLE,
    RENTABLE,
}

export interface IAvailability {
    type: AvailabilityType;
}

export interface ISearchOpts {
    /**
     * If true (default) only items that are immediately available for
     * playing somehow (either through an active subscription or if
     * already purchased) will be returned.
     */
    onlyPlayable?: boolean;
}

export interface ISearchResult {
    availability: IAvailability[];
    cover?: string;
    desc?: string;
    id: string;
    isPurchased?: boolean;
    isInWatchlist?: boolean;
    title: string;
    titleId: string;
    type: ContentType;
    watchUrl: string;
}

export interface IPrimeApiInternal {
    swiftApiRequest(path: string, qs?: Record<string, unknown>): Promise<any>;
}
