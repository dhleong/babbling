import type { IRecommendation, IRecommendationQuery } from "../app";

export function recommendationQueryMatches(
    query: IRecommendationQuery | undefined,
    _item: IRecommendation,
) {
    if (query == null) {
        return true;
    }

    // TODO: Handle query params
    return true;
}

export default async function* filterRecommendations<T extends IRecommendation>(
    query: IRecommendationQuery | undefined,
    items: AsyncIterable<T>,
) {
    for await (const item of items) {
        if (recommendationQueryMatches(query, item)) {
            yield item;
        }
    }
}
