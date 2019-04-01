import fs from "fs-extra";
import os from "os";
import pathlib from "path";
import util from "util";

import _debug from "debug";
const debug = _debug("babbling:config");

import { CookieExtractor, LocalStorageExtractor } from "chromagnon";
import { IApp, IAppConstructor, IPlayerEnabledConstructor, Opts } from "../app";
import { readConfig } from "./commands/config";
import { isConfigurable } from "./model";

export const DEFAULT_CONFIG_PATH = pathlib.join(
    os.homedir(),
    ".config/babbling/auto-config.json",
);

async function *getAppConstructors(): AsyncIterable<IAppConstructor<any, IApp>> {
    const allExports = require("../index");
    for (const name of Object.keys(allExports)) {
        if (name.endsWith("App") && allExports[name] instanceof Function) {
            yield allExports[name];
        }
    }
}

export class ConfigExtractor {
    public async extract() {
        const cookies = await CookieExtractor.create();
        const storage = await LocalStorageExtractor.create();

        const config: any = {};

        try {
            for await (const app of getAppConstructors()) {
                if (isConfigurable(app)) {
                    debug("Configuring", app.name);
                    const extracted = await app.configurable.extractConfig(cookies, storage);
                    config[app.name] = extracted;
                }
            }
        } finally {
            cookies.close();
        }

        return config;
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
