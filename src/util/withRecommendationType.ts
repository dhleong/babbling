import { IQueryResult, RecommendationType } from "../app";

export default async function* withRecommendationType<T extends IQueryResult>(
    recommendationType: RecommendationType,
    items: AsyncIterable<T>,
): AsyncIterable<T & { recommendationType: RecommendationType }> {
    for await (const item of items) {
        yield {
            ...item,
            recommendationType,
        };
    }
}
