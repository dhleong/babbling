import * as chai from "chai";

import {
    interleaveAsyncIterables,
    mergeAsyncIterables,
    toArray,
} from "../src/async";

chai.should();

const sleep = (millis: number) => new Promise(resolve => {
    setTimeout(resolve, millis);
});

describe("mergeAsyncIterables", () => {
    it("Respects original order", async () => {
        const array = await toArray(
            mergeAsyncIterables([
                (async function* generator() {
                    yield 0;
                    yield 1;
                    yield 2;
                }()),
            ]),
        );

        array.should.deep.equal([0, 1, 2]);
    });

    it("Doesn't omit any values", async () => {
        const array = await toArray(
            mergeAsyncIterables([
                (async function* generator() {
                    yield 0;
                    yield 1;
                    yield 2;
                }()),
                (async function* generator() {
                    yield 3;
                    yield 4;
                    yield 5;
                }()),
            ]),
        );

        array.should.contain.all.members([0, 1, 2, 3, 4, 5]);
    });

    it("interleaves if necessary", async () => {
        const array = await toArray(
            mergeAsyncIterables([
                (async function* generator() {
                    yield 0;
                    await sleep(20);
                    yield 1;
                    await sleep(20);
                    yield 2;
                }()),
                (async function* generator() {
                    await sleep(6);
                    yield 10;
                    await sleep(6);
                    yield 11;
                    await sleep(12);
                    yield 12;
                }()),
            ]),
        );

        array.should.deep.equal([0, 10, 11, 1, 12, 2]);
    });
});

describe("interleaveAsyncIterables", () => {
    it("Respects original order", async () => {
        const array = await toArray(
            interleaveAsyncIterables([
                (async function* generator() {
                    yield 0;
                    yield 1;
                    yield 2;
                }()),
            ]),
        );

        array.should.deep.equal([0, 1, 2]);
    });

    it("Interleaves all", async () => {
        const array = await toArray(
            interleaveAsyncIterables([
                (async function* generator() {
                    yield 0;
                    yield 2;
                    yield 4;
                }()),
                (async function* generator() {
                    yield 1;
                    yield 3;
                    yield 5;
                }()),
            ]),
        );

        array.should.deep.equal([0, 1, 2, 3, 4, 5]);
    });

    it("Interleaves all with sleeps", async () => {
        const array = await toArray(
            interleaveAsyncIterables([
                (async function* generator() {
                    yield 0;
                    await sleep(10);
                    yield 2;
                    await sleep(10);
                    yield 4;
                }()),
                (async function* generator() {
                    yield 1;
                    await sleep(10);
                    yield 3;
                    await sleep(10);
                    yield 5;
                }()),
            ]),
        );

        array.should.deep.equal([0, 1, 2, 3, 4, 5]);
    });
});
