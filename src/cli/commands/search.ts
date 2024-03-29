/* eslint-disable no-console */

import createDebug from "debug";

import { IQueryResult } from "../../app";
import { PlayerBuilder } from "../../player";
import { consoleWrite } from "./util";

const debug = createDebug("babbling:cli:search");

export interface ISearchByTitleOpts {
    config: string;
    title: string;
}

function padLeft(s: string, width: number) {
    if (s.length === width) {
        return s;
    }
    if (s.length > width) {
        return s.substring(0, width);
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
    const player = builder.buildQueryOnly();

    const results = player.queryByTitle(opts.title, (app, e) => {
        debug("Encountered error searching", app, e);
    });

    await formatQueryResults(results);
}
