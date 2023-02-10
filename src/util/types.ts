export type CollectionItem<T> = T extends Array<infer I>
    ? I
    : T extends Set<infer I>
    ? I
    : never;
