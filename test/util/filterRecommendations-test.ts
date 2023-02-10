import * as chai from "chai";

import { IRecommendation, RecommendationType } from "../../src/app";
import { queryToPredicate } from "../../src/util/filterRecommendations";

chai.should();

function ofType(recommendationType: RecommendationType): IRecommendation {
    return {
        appName: "testapp",
        title: "Test",
        recommendationType,
        playable: () => {
            throw new Error();
        },
    };
}

describe("queryToPredicate", () => {
    it("supports the default query", () => {
        const pred = queryToPredicate(undefined);
        pred(ofType(RecommendationType.Recent)).should.be.true;
        pred(ofType(RecommendationType.Saved)).should.be.true;
        pred(ofType(RecommendationType.Popular)).should.be.true;
    });

    it("supports excluding types", () => {
        const pred = queryToPredicate({
            excludeTypes: [RecommendationType.Recent, RecommendationType.Saved],
        });
        pred(ofType(RecommendationType.Recent)).should.be.false;
        pred(ofType(RecommendationType.Saved)).should.be.false;
        pred(ofType(RecommendationType.Popular)).should.be.true;
    });
});
