/* eslint-disable no-console */

import { IQueryResult } from "../../app";
import { ChromecastDevice } from "../../device";
import { PlayerBuilder } from "../../player";
import { consoleWrite } from "./util";

export interface ISearchByTitleOpts {
    config: string;
    title: string;
}

function padLeft(s: string, width: number) {
    if (s.length === width) {
        return s;
    } if (s.length > width) {
        return s.substr(0, width);
    }

    const delta = width - s.length;
    return " ".repeat(delta) + s;
}

export async function formatQueryResults(results: AsyncIterable<IQueryResult>) {
    let found = 0;
    for await (const match of results) {
        ++found;

        const app = padLeft(match.appName.replace(/App$/, ""), 8);
        console.log(`${app}: ${match.title}`);
        if (match.url) {
            console.log(`    - ${match.url}`);
        }
        if (match.hasAds) {
            console.log("    * Includes Advertisements");
        }
        if (match.desc) {
            console.log(`    ${match.desc}`);
        }

        console.log();
    }

    if (!found) {
        consoleWrite("No results");
    }
}

export default async function searchByTitle(opts: ISearchByTitleOpts) {
    const builder = await PlayerBuilder.autoInflate(opts.config);
    builder.addDevice(new ChromecastDevice("_unused_"));
    const player = builder.build();

    const results = player.queryByTitle(opts.title);

    await formatQueryResults(results);
}
