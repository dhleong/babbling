
export enum AvailabilityType {
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
