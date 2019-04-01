import { IAppConstructor } from "../app";

export interface ICookieSource {
    query(url: string): AsyncIterable<{name: string, value: string}>;
}

export interface ILocalStorageSource {
    readAll(url: string): AsyncIterable<{key: string, value: string}>;
}

export interface IConfigSource {
    cookies: ICookieSource;
    storage: ILocalStorageSource;
}

export interface IConfigurable<TConfig> {
    extractConfig(
        source: IConfigSource,
    ): Promise<Partial<TConfig> | undefined>;
}

export interface IConfigurableApp<TConfig> extends IAppConstructor<any, any> {
    configurable: IConfigurable<TConfig>;
}

export function isConfigurable<Opts extends []>(app: IAppConstructor<Opts, any>): app is IConfigurableApp<Opts> {
    return (app as any).configurable;
}
