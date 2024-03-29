import { PlayerBuilder } from "../../player";

import { formatQueryResults } from "./search";

export interface IGetRecommendationsOpts {
    config: string;
}

export default async function getRecommendations(
    opts: IGetRecommendationsOpts,
) {
    const builder = await PlayerBuilder.autoInflate(opts.config);
    const player = builder.buildQueryOnly();

    await formatQueryResults(player.queryRecommended());
}
