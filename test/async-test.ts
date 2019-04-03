import * as chai from "chai";

import { mergeAsyncIterables, toArray } from "../src/async";

chai.should();

const sleep = (millis: number) => new Promise(resolve => {
    setTimeout(resolve, millis);
});

describe("mergeAsyncIterables", () => {
    it("Respects original order", async () => {
        const array = await toArray(mergeAsyncIterables([
            (async function*() {
                yield 0;
                yield 1;
                yield 2;
            })(),
        ]));

        array.should.deep.equal([0, 1, 2]);
    });

    it("Doesn't omit any values", async () => {
        const array = await toArray(mergeAsyncIterables([
            (async function*() {
                yield 0;
                yield 1;
                yield 2;
            })(),

            (async function*() {
                yield 3;
                yield 4;
                yield 5;
            })(),
        ]));

        array.should.contain.all.members([ 0, 1, 2, 3, 4, 5 ]);
    });

    it("interleaves if necessary", async () => {
        const array = await toArray(mergeAsyncIterables([
            (async function*() {
                yield 0;
                await sleep(10);
                yield 1;
                await sleep(10);
                yield 2;
            })(),

            (async function*() {
                await sleep(3);
                yield 10;
                await sleep(3);
                yield 11;
                await sleep(6);
                yield 12;
            })(),
        ]));

        array.should.deep.equal([0, 10, 11, 1, 12, 2]);
    });
});
