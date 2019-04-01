import os from "os";
import pathlib from "path";

import { IApp, IAppConstructor, IPlayerEnabledConstructor, Opts } from "../app";
import { readConfig } from "./commands/config";

export const DEFAULT_CONFIG_PATH = pathlib.join(
    os.homedir(),
    ".config/babbling/auto-config.json",
);

export async function *getAppConstructors(): AsyncIterable<IAppConstructor<any, IApp>> {
    const allExports = require("../index");
    for (const name of Object.keys(allExports)) {
        if (name.endsWith("App") && allExports[name] instanceof Function) {
            yield allExports[name];
        }
    }
}

export async function *importConfig(configPath?: string) {
    const config = await readConfig(configPath || DEFAULT_CONFIG_PATH);

    yield *importConfigFromJson(config);
}

type ConfigPair<TOpts extends Opts> = [IPlayerEnabledConstructor<TOpts, IApp>, Opts];

export async function *importConfigFromJson(config: any) {

    for await (const app of getAppConstructors()) {
        if (config[app.name]) {
            yield [app, config[app.name]] as ConfigPair<any>;
        }
    }
}
