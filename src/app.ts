import { IDevice } from "nodecastor";

export interface IApp {
    start(): Promise<any>;
}

export interface IAppConstructor<TOptions, TSelf extends IApp> {
    new (device: IDevice, options?: TOptions): TSelf;
}
