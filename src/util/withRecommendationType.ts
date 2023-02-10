import { IQueryResult, RecommendationType } from "../app";

export default async function* withRecommendationType<T extends IQueryResult>(
    items: AsyncIterable<T>,
    recommendationType: RecommendationType,
): AsyncIterable<T & { recommendationType: RecommendationType }> {
    for await (const item of items) {
        yield {
            ...item,
            recommendationType,
        };
    }
}
