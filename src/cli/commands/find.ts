import leven from "leven";

import { IQueryResult } from "../../app";
import { ChromecastDevice } from "../../device";
import { PlayerBuilder } from "../../player";
import { consoleWrite } from "./util";

export interface IFindByTitleOpts {
    config: string;
    device: string;
    title: string;
}

const MAX_CANDIDATES = 30;

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

        const score = 1 / distance;
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

    const candidates = player.queryByTitle(opts.title);
    const best = await pickBestMatchForTitle(candidates, opts.title);

    if (!best) {
        throw new Error("No match found");
    }

    consoleWrite(`Playing ${best.title} via ${best.appName}`);

    await player.play(best);
}
