import createDebug from "debug";
import leven from "leven";

import { IQueryResult } from "../../app";
import { ChromecastDevice } from "../../device";
import { PlayerBuilder } from "../../player";
import { consoleWrite } from "./util";

const debug = createDebug("babbling:cli:find");

export interface IFindByTitleOpts {
    config: string;
    device: string;
    title: string;

    "dry-run"?: boolean;
    episode?: number;
    season?: number;
}

const MAX_CANDIDATES = 30;

function lerp(from: number, to: number, fraction: number) {
    return (1 - fraction) * from + fraction * to;
}

export async function pickBestMatchForTitle(
    candidates: AsyncIterable<IQueryResult>,
    title: string,
) {
    const target = title.toLowerCase();

    let best: IQueryResult | undefined;
    let bestScore = -1;

    let i = 0;
    for await (const item of candidates) {
        const distance = leven(
            item.title.toLowerCase(),
            target,
        );
        if (distance === 0) {
            // probably a safe bet?
            return item;
        }

        let score = 1 / distance;
        if (item.isPreferred) {
            score = lerp(score, 1, 0.5);
        } else if (item.hasAds) {
            // in case another service has the same title
            // but without ads
            score = lerp(score, 0, 0.5);
        }

        if (score > bestScore) {
            bestScore = score;
            best = item;
        }

        if (++i > MAX_CANDIDATES) {
            break;
        }
    }

    return best;
}

export default async function findByTitle(opts: IFindByTitleOpts) {
    const builder = await PlayerBuilder.autoInflate(opts.config);
    builder.addDevice(new ChromecastDevice(opts.device));
    const player = builder.build();

    const candidates = player.queryByTitle(opts.title, (app, e) => {
        debug("Encountered error searching", app, e);
    });
    const best = await pickBestMatchForTitle(candidates, opts.title);

    if (!best) {
        throw new Error("No match found");
    }

    if (opts.season === undefined && opts.episode === undefined) {
        consoleWrite(`Playing ${best.title} via ${best.appName}`);

        if (!opts["dry-run"]) {
            await player.play(best);
        }
        return;
    }

    if (opts.season === undefined) {
        throw new Error("--episode may not be provided without --season");
    }

    const episodeNumber = opts.episode !== undefined
        ? opts.episode
        : 1;
    const episode = await player.findEpisodeFor(best, {
        episodeIndex: episodeNumber - 1,
        seasonIndex: opts.season - 1,
    });

    if (!episode) {
        throw new Error(`No matching episode for ${best.title} on ${best.appName}`);
    }

    let label = `S${opts.season}E${episodeNumber}`;
    if (episode.title !== label) {
        label += ` "${episode.title}"`;
    }
    consoleWrite(`Playing ${best.title}: ${label} via ${best.appName}`);

    if (!opts["dry-run"]) {
        await player.play(episode);
    }
}
