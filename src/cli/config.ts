import _debug from "debug";

import os from "os";
import pathlib from "path";

import { IApp, IPlayerEnabledConstructor, Opts } from "../app";
import { BabblerBaseApp } from "../apps/babbler/base";
import { IWritableToken } from "../token";
import { configInPath, readConfig } from "./commands/config";

import { getAppConstructors } from "./getAppConstructors";

export { getAppConstructors };

const debug = _debug("babbling:config");

export const DEFAULT_CONFIG_PATH = pathlib.join(
    os.homedir(),
    ".config/babbling/auto-config.json",
);

type ConfigPair<TOpts extends Opts> = [
    IPlayerEnabledConstructor<TOpts, IApp>,
    Opts,
];

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

export async function* importConfigFromJson(configPath: string, config: any) {
    for await (const app of getAppConstructors()) {
        const appConfig = config[app.name];
        if (!appConfig) continue;

        if (
            app.prototype instanceof BabblerBaseApp &&
            config.babbler &&
            !appConfig.appId
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

export async function* importConfig(configPath?: string) {
    const actualPath = configPath || DEFAULT_CONFIG_PATH;
    const config = await readConfig(actualPath);

    yield* importConfigFromJson(actualPath, config);
}
