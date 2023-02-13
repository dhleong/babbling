import type { IRecommendation, IRecommendationQuery } from "../app";

type Predicate = (item: IRecommendation) => boolean;

export function queryToPredicate(
    query: IRecommendationQuery | undefined,
): Predicate {
    if (query == null) {
        return () => true;
    }

    const predicates: Predicate[] = [];

    const { excludeTypes } = query;
    if (excludeTypes != null) {
        const excludedSet = new Set(excludeTypes);
        predicates.push((item) => !excludedSet.has(item.recommendationType));
    }

    return (item: IRecommendation) => {
        return predicates.every((predicate) => predicate(item));
    };
}

export default async function* filterRecommendations<T extends IRecommendation>(
    query: IRecommendationQuery | undefined,
    items: AsyncIterable<T>,
) {
    const predicate = queryToPredicate(query);
    for await (const item of items) {
        if (predicate(item)) {
            yield item;
        }
    }
}
