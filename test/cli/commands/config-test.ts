import * as chai from "chai";

import { setPath } from "../../../src/cli/commands/config";

chai.should();

describe("setPath", () => {
    it("handles 1-length paths", () => {
        setPath({ name: "serenity" }, ["name"], "mreynolds")
            .should.deep.equal({ name: "mreynolds" });
    });

    it("handles multi-length paths", () => {
        setPath({ name: "serenity" }, ["type", "name"], "firefly")
            .should.deep.equal({
                name: "serenity",
                type: {
                    name: "firefly",
                },
            });
    });
});
