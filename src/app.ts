import { IDevice } from "nodecastor";

export interface IApp {
    start(): Promise<any>;
}

export type Opts = any[];

export interface IAppConstructor<TOptions extends Opts, TSelf extends IApp> {
    new (device: IDevice, ...options: TOptions): TSelf;
}

export type OptionsFor<T> =
    T extends IAppConstructor<infer TOpt, infer TSelf> ? TOpt :
    never;

export type AppFor<T> =
    T extends IAppConstructor<infer TOpt, infer TSelf> ? TSelf :
    never;

type IPlayable<T extends IApp> = (app: T) => Promise<void>;

export interface IPlayerEnabledConstructor<TOptions extends Opts, TSelf extends IApp>
extends IAppConstructor<TOptions, TSelf> {

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

}
