// tslint:disable no-console max-classes-per-file

import { CookieExtractor, LocalStorageExtractor } from "chromagnon";

import _debug from "debug";
const debug = _debug("babbling:config");

import { consoleWrite, prompt } from "./util";

import { getAppConstructors } from "../config";
import { IConfigSource, ILocalStorageSource, isConfigurable } from "../model";
import { IAuthOpts } from "./auth/config";
import { readConfig, writeConfig } from "./config";

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
    public async extract(
        ignoreErrors?: boolean,
    ) {
        const source = await ChromagnonSource.create();

        const config: any = {};

        try {
            for await (const app of getAppConstructors()) {
                try {
                    if (isConfigurable(app)) {
                        debug("Configuring", app.name);
                        const extracted = await app.configurable.extractConfig(source);
                        config[app.name] = extracted;
                    } else {
                        debug("Unable to auto-configure", app.name);
                    }
                } catch (e) {
                    if (ignoreErrors !== true) {
                        throw e;
                    } else {
                        console.warn("Unable to auto-configure:", app.name);
                        console.error(e);
                    }
                }
            }
        } finally {
            source.close();
        }

        return config;
    }
}

export async function authenticate(opts: IAuthOpts) {
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
        const config = await extractor.extract(
            opts.ignoreErrors,
        );

        consoleWrite(`Extracted auth:`);
        console.log(config);

        // don't delete pre-existing values
        const existing = await readConfig(opts.config);

        await writeConfig(opts.config, Object.assign(existing, config));
        consoleWrite(`
Wrote config to: ${opts.config}
        `);

    } catch (e) {
        consoleWrite(`
Unable to complete authentication extraction:

    ${e}

You may need to quit Chrome before trying again.
        `);
    }
}
