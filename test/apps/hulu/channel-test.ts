import * as chai from "chai";

import { createUrl, extractIdFromUrl } from "../../../src/apps/hulu/channel";

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
