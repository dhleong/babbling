import * as chai from "chai";

import { updateConfig } from "../../../src/cli/commands/config";

chai.should();

describe("updateConfig", () => {
    it("handles 1-length paths", () => {
        updateConfig({ name: "serenity" }, ["name"], "mreynolds")
            .should.deep.equal({ name: "mreynolds" });
    });

    it("handles multi-length paths", () => {
        updateConfig({ name: "serenity" }, ["type", "name"], "firefly")
            .should.deep.equal({
                name: "serenity",
                type: {
                    name: "firefly",
                },
            });
    });
});
