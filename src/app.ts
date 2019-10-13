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
     * Playable URL for this entity, if available
     */
    url?: string;

    /** @internal */
    playable: IPlayable<any>;
}

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
    createPlayable(url: string, ...options: OptionsFor<TSelf>): Promise<IPlayable<AppFor<TSelf>>>;

    /**
     *
     */
    queryByTitle?(title: string, ...options: OptionsFor<TSelf>): AsyncIterable<IQueryResult>;

}

export interface IPlayerEnabledConstructor<TOptions extends Opts, TSelf extends IApp>
extends IAppConstructor<TOptions, TSelf> {

    /**
     * Create a Channel that can be used to interact with this App
     * and its associated service
     */
    createPlayerChannel(): IPlayerChannel<TSelf>;

}
