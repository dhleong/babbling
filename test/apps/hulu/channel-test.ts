import * as chai from "chai";

import { extractIdFromUrl } from "../../../src/apps/hulu/channel";
import { createUrl } from "../../../src/apps/hulu/playable";

chai.should();

describe("HuluPlayerChannel", () => {
    describe("extractIdFromUrl", () => {
        it("handles the normal case", () => {
            const id = "65d158d4-443f-44c7-bd2c-eae39f6c60e9";
            const url = createUrl("series", id);
            extractIdFromUrl(url).should.equal(id);
        });
    });
});
