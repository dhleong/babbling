import * as chai from "chai";

import { setPath, createConfigUpdater } from "../../../src/cli/commands/config";

chai.should();

const delay = (millis: number) =>
    new Promise((resolve) => {
        setTimeout(resolve, millis);
    });

describe("setPath", () => {
    it("handles 1-length paths", () => {
        setPath({ name: "serenity" }, ["name"], "mreynolds").should.deep.equal({
            name: "mreynolds",
        });
    });

    it("handles multi-length paths", () => {
        setPath(
            { name: "serenity" },
            ["type", "name"],
            "firefly",
        ).should.deep.equal({
            name: "serenity",
            type: {
                name: "firefly",
            },
        });
    });
});

describe("configUpdater", () => {
    it("prevents simultaneous file writes", async () => {
        let storedConfig = 1;
        const update = createConfigUpdater(
            async () => {
                delay(10); // simulate disk access
                return storedConfig;
            },
            async (path: string, value: any) => {
                delay(10);
                storedConfig = value;
            },
        );

        const first = update("", (old) => old + 2);
        const second = update("", (old) => old + 4);
        await Promise.all([first, second]);

        storedConfig.should.equal(7);
    });
});
