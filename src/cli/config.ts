import _debug from "debug";
const debug = _debug("babbling:config");

import os from "os";
import pathlib from "path";

import { IApp, IAppConstructor, IPlayerEnabledConstructor, Opts } from "../app";
import { BabblerBaseApp } from "../apps/babbler/base";
import { IWritableToken } from "../token";
import { configInPath, readConfig } from "./commands/config";

export const DEFAULT_CONFIG_PATH = pathlib.join(
    os.homedir(),
    ".config/babbling/auto-config.json",
);

export async function *getAppConstructors(): AsyncIterable<IAppConstructor<any, IApp>> {
    const allExports = require("../index");
    for (const name of Object.keys(allExports)) {
        if (
            name.endsWith("App")
            && !name.endsWith("BaseApp")
            && allExports[name] instanceof Function
        ) {
            yield allExports[name];
        }
    }
}

export async function *importConfig(configPath?: string) {
    const actualPath = configPath || DEFAULT_CONFIG_PATH;
    const config = await readConfig(actualPath);

    yield *importConfigFromJson(actualPath, config);
}

type ConfigPair<TOpts extends Opts> = [IPlayerEnabledConstructor<TOpts, IApp>, Opts];

export async function *importConfigFromJson(
    configPath: string,
    config: any,
) {

    for await (const app of getAppConstructors()) {
        const appConfig = config[app.name];
        if (!appConfig) continue;

        if (
            app.prototype instanceof BabblerBaseApp
            && config.babbler
            && !appConfig.appId
        ) {
            appConfig.appId = config.babbler;
        }

        if (app.tokenConfigKeys) {
            for (const k of app.tokenConfigKeys) {
                appConfig[k] = new AppConfigToken(
                    configPath,
                    [app.name, k],
                    appConfig[k],
                );
            }
        }

        yield [app, appConfig] as ConfigPair<any>;
    }
}

class AppConfigToken implements IWritableToken {
    constructor(
        private configPath: string,
        private tokenPath: string[],
        private value: string,
    ) {}

    public read(): string {
        return this.value;
    }

    public async write(newValue: string): Promise<void> {
        if (newValue === this.value) {
            debug("unchanged", this.tokenPath, " <- ", newValue);
            return;
        }

        debug("update", this.tokenPath, " <- ", newValue);

        this.value = newValue;
        await configInPath(this.configPath, this.tokenPath, newValue);
    }

    public toJSON(): string {
        return this.value;
    }

    public toString(): string {
        return this.value;
    }
}
