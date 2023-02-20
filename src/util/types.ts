export type CollectionItem<T> = T extends ReadonlyArray<infer I>
    ? I
    : T extends Set<infer I>
    ? I
    : never;
