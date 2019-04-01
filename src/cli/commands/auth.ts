// tslint:disable no-console max-classes-per-file

import { CookieExtractor, LocalStorageExtractor } from "chromagnon";

import _debug from "debug";
const debug = _debug("babbling:config");

import { consoleWrite, prompt } from "./util";

import { DEFAULT_CONFIG_PATH, getAppConstructors } from "../config";
import { IConfigSource, ILocalStorageSource, isConfigurable } from "../model";
import { writeConfig } from "./config";

class ChromagnonSource implements IConfigSource {

    public static async create() {
        const cookies = await CookieExtractor.create();
        const storage = await LocalStorageExtractor.create();
        return new ChromagnonSource(cookies, storage);
    }

    constructor(
        public cookies: CookieExtractor,
        public storage: ILocalStorageSource,
    ) {}

    public close() {
        this.cookies.close();
    }
}

export class ConfigExtractor {
    public async extract() {
        const source = await ChromagnonSource.create();

        const config: any = {};

        try {
            for await (const app of getAppConstructors()) {
                if (isConfigurable(app)) {
                    debug("Configuring", app.name);
                    const extracted = await app.configurable.extractConfig(source);
                    config[app.name] = extracted;
                }
            }
        } finally {
            source.close();
        }

        return config;
    }
}

export default async function authenticate() {
    consoleWrite(`
This process will attempt to extract authentication for as many Apps as
possible from Chrome. You should close Chrome now for this to complete
successfully.

On macOS you will be prompted to enter a password so we can decrypt
cookies for some apps.
    `);

    await prompt("\nPress enter to continue");

    const extractor = new ConfigExtractor();
    try {
        const config = await extractor.extract();

        consoleWrite(`Extracted auth:`);
        console.log(config);

        await writeConfig(DEFAULT_CONFIG_PATH, config);
        consoleWrite(`
Wrote config to: ${DEFAULT_CONFIG_PATH}
        `);

    } catch (e) {
        consoleWrite(`
Unable to complete authentication extraction:

    ${e}

You may need to quit Chrome before trying again.
        `);
    }
}
