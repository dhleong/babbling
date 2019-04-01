import { CookieExtractor, LocalStorageExtractor } from "chromagnon";
import { IAppConstructor } from "../app";

export interface IConfigurable<TConfig> {
    extractConfig(
        cookies: CookieExtractor,
        storage: LocalStorageExtractor,
    ): Promise<Partial<TConfig> | undefined>;
}

export interface IConfigurableApp<TConfig> extends IAppConstructor<any, any> {
    configurable: IConfigurable<TConfig>;
}

export function isConfigurable<Opts extends []>(app: IAppConstructor<Opts, any>): app is IConfigurableApp<Opts> {
    return (app as any).configurable;
}
