import { IDevice } from "./cast";

export interface IApp {
    start(): Promise<any>;
}

export type Opts = any[];

export interface IAppConstructor<TOptions extends Opts, TSelf extends IApp> {
    tokenConfigKeys?: string[];

    new (device: IDevice, ...options: TOptions): TSelf;
}

export type OptionsFor<T> =
    T extends IAppConstructor<infer TOpt, infer TSelf> ? TOpt :
    never;

export type AppFor<T> =
    T extends IAppConstructor<infer TOpt, infer TSelf> ? TSelf :
    never;

export interface IPlayableOptions {
    /**
     * By default, if the app supports it (and we know how) we will
     * attempt to resume playback of whatever entity is represented by
     * a Playable:
     *
     * - Series (and playlists) should resume the next episode in the
     *   series, or the last watched if unfinished
     * - Episodes and movies should resume wherever we left off, or
     *   start at the beginning if new or completed
     *
     * If you prefer to start at the beginning regardless of whatever
     * resume features the app supports for the given entity---assuming
     * the app supports disabling resume for the entity---pass `false`
     * for this value.
     */
    resume?: boolean;

    /**
     * By default, if the app supports it (and we know how) we will
     * attempt to skip intros and recaps, provided that doing so
     * wouldn't lose a significant amount of watchable content.
     */
    skipIntros?: boolean;
    skipRecaps?: boolean;

    /**
     * See [skipIntros]. If the amount of time before the block of
     * time represented by an intro/recap/combination thereof is longer
     * than this duration (in milliseconds), we won't skip.
     */
    maxSkippableDurationMs?: number;
}

export type IPlayable<T extends IApp> = (app: T, opts: IPlayableOptions) => Promise<void>;

export interface IQueryResult {
    /**
     * The name of the app that provided the result
     */
    appName: string;

    /**
     * Title of the entity that matched the query
     */
    title: string;

    /**
     * Description of the entity, if available
     */
    desc?: string;

    /**
     * Image URL for cover art, if available
     */
    cover?: string;

    /**
     * Playable URL for this entity, if available
     */
    url?: string;

    /** @internal */
    playable: IPlayable<any>;

    /**
     * If `true`, the item can be played, but will have ads
     */
    hasAds?: boolean;

    /**
     * If `true`, it is a preferred result from the service,
     * perhaps bookmarked or in a "watch list"
     */
    isPreferred?: boolean;
}

export interface IEpisodeQueryResult extends IQueryResult {
    seriesTitle: string;
}

export interface ISeasonAndEpisodeQuery {
    episodeIndex: number;
    seasonIndex: number;
}

/**
 * IEpisodeQuery is a map describing how to locate a specific
 * episode to play within a series. Not all providers will
 * support all query types; in such cases, their channel should
 * return an empty set
 */
export type IEpisodeQuery = ISeasonAndEpisodeQuery;

/**
 * The IPlayerChannel interface is a high-level, unified means of
 * interacting with a particular app and its service.
 */
export interface IPlayerChannel<TSelf extends IApp> {

    /**
     * Return true if your app "owns" the given URL. The first
     * app that returns `true` from this method will be elected
     * to `createPlayable` for the URL.
     */
    ownsUrl(url: string): boolean;

    /**
     * Will only be called if {@see canPlayUrl} returned `true`.
     * If the URL resolves to something that can't be played,
     * the returned Promise should reject.
     */
    createPlayable(url: string): Promise<IPlayable<AppFor<TSelf>>>;

    /**
     * Find a specific {@see Player.play}'able episode for the
     * given {@see IQueryResult}.
     */
    findEpisodeFor?(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined>;

    /**
     * Search for {@see Player.play}'able media by title
     */
    queryByTitle?(title: string): AsyncIterable<IQueryResult>;

    /**
     * Search for {@see Player.play}'able media by title, requesting a specific
     * episode in the matching series
     */
    queryEpisodeForTitle?(title: string, query: IEpisodeQuery): AsyncIterable<IEpisodeQueryResult>;

    /**
     * Search for {@see Player.play}'able media per the source
     * apps' recommendations. Could be (but not necessarily)
     * based on recency
     */
    queryRecommended?(): AsyncIterable<IQueryResult>;

}

export interface IPlayerEnabledConstructor<TOptions extends Opts, TSelf extends IApp>
extends IAppConstructor<TOptions, TSelf> {

    /**
     * Create a Channel that can be used to interact with this App
     * and its associated service
     */
    createPlayerChannel(options?: TOptions): IPlayerChannel<TSelf>;

}
