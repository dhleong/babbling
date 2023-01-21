const NO_VALUE = Symbol();

export default class Expirable<T> {
    private value: T | typeof NO_VALUE = NO_VALUE;
    private valueExpires = 0;

    constructor(private readonly factory: () => Promise<{ value: T, expiresInSeconds: number }>) {}

    public async get(): Promise<T> {
        const { value, valueExpires } = this;
        if (Date.now() < valueExpires && value !== NO_VALUE) {
            return value;
        }

        const { value: newValue,  expiresInSeconds } = await this.factory();
        this.value = newValue;
        this.valueExpires = Date.now() + (expiresInSeconds * 1000);
        return newValue;
    }
}
