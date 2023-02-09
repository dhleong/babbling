/*
 * Async util methods
 */

export async function* mergeAsyncIterables<T>(
    iterables: Array<AsyncIterable<T>>,
): AsyncIterable<T> {
    const finished = new Promise<any>(() => null);

    const iterators = iterables.map((it) => it[Symbol.asyncIterator]());
    let incomplete = iterables.length;

    const next = async (iterator: AsyncIterator<T>, index: number) => {
        const result = await iterator.next();
        return { index, result };
    };

    const nextPromises = iterators.map(next);
    while (incomplete) {
        const { index, result } = await Promise.race(nextPromises);
        if (result.done) {
            nextPromises[index] = finished;
            --incomplete;
        } else {
            nextPromises[index] = next(iterators[index], index);
        }

        if (result.value !== undefined) {
            yield result.value;
        }
    }
}

export async function* interleaveAsyncIterables<T>(
    iterables: Array<AsyncIterable<T>>,
): AsyncIterable<T> {
    const finished = new Promise<any>(() => null);

    const iterators = iterables.map((it) => it[Symbol.asyncIterator]());
    let incomplete = iterables.length;

    const next = async (iterator: AsyncIterator<T>, index: number) => {
        const result = await iterator.next();
        return { index, result };
    };

    const nextPromises = iterators.map(next);
    while (incomplete) {
        for (const p of nextPromises) {
            if (p === finished) continue;

            const { index, result } = await p;

            if (result.done) {
                nextPromises[index] = finished;
                --incomplete;
            } else {
                nextPromises[index] = next(iterators[index], index);
            }

            if (result.value !== undefined) {
                yield result.value;
            }
        }
    }
}

export async function toArray<T>(iterable: AsyncIterable<T>) {
    const result: T[] = [];

    for await (const v of iterable) {
        result.push(v);
    }

    return result;
}

const nop = () => {
    /* nop */
};

export class Deferred<T> {
    public resolve: (v: T) => void = nop;
    public reject: (e?: Error) => void = nop;

    public readonly promise = new Promise<T>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
}
