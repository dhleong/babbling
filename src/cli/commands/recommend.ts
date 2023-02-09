import { ChromecastDevice } from "../../device";
import { PlayerBuilder } from "../../player";

import { formatQueryResults } from "./search";

export interface IGetRecommendationsOpts {
    config: string;
}

export default async function getRecommendations(
    opts: IGetRecommendationsOpts,
) {
    const builder = await PlayerBuilder.autoInflate(opts.config);
    builder.addDevice(new ChromecastDevice("_unused_"));
    const player = builder.build();

    await formatQueryResults(player.queryRecommended());
}
