// tslint:disable no-console

import { consoleWrite, prompt } from "./util";

import { ConfigExtractor, DEFAULT_CONFIG_PATH } from "../config";

export default async function configure() {
    consoleWrite(`
This process will attempt to extract configuration for as many Apps as
possible from Chrome. You should close Chrome now for this to complete
successfully.

On macOS you will be prompted to enter a password so we can decrypt
cookies for some apps.
    `);

    await prompt("\nPress enter to continue");

    const extractor = new ConfigExtractor();
    try {
        const config = await extractor.extract();

        consoleWrite(`Extracted config:`);
        console.log(config);

        await extractor.writeConfig(DEFAULT_CONFIG_PATH, config);
        consoleWrite(`
Wrote config to: ${DEFAULT_CONFIG_PATH}
        `);

    } catch (e) {
        consoleWrite(`
Unable to complete auto-config extraction:

    ${e}

You may need to quit Chrome before trying again.
        `);
    }
}
