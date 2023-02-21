const NO_VALUE = Symbol();

export default class Shared<T> {
    private shared: Promise<T> | typeof NO_VALUE = NO_VALUE;

    constructor(private readonly factory: () => Promise<T>) {}

    public get(): Promise<T> {
        const { shared } = this;
        if (shared !== NO_VALUE) {
            return shared;
        }

        const newValue = this.factory();
        this.shared = newValue;
        return newValue;
    }
}
