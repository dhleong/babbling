import fs from "fs-extra";
import os from "os";
import pathlib from "path";
import util from "util";

import _debug from "debug";
const debug = _debug("babbling:config");

import { CookieExtractor, LocalStorageExtractor } from "chromagnon";
import { IApp, IAppConstructor } from "../app";
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

    public async writeConfig(path: string, config: any) {
        await fs.mkdirp(pathlib.dirname(path));
        return fs.writeFile(path, JSON.stringify(config, null, "  "));
    }
}

export async function *importConfig(configPath?: string) {
    const contents = await fs.readFile(configPath || DEFAULT_CONFIG_PATH);
    const config = JSON.parse(contents.toString());

    yield *importConfigFromJson(config);
}

export async function *importConfigFromJson(config: any) {

    for await (const app of getAppConstructors()) {
        if (config[app.name]) {
            yield [app, config[app.name]];
        }
    }
}
