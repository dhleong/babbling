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
