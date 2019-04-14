
// tslint:disable no-bitwise
export enum SenderCapabilities {
    None = 0,

    DeferredInfo = 1 << 1,

    QueueNext = 1 << 2,
    QueuePrev = 1 << 3,
}
// tslint:enable no-bitwise
