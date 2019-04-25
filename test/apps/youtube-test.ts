import * as chai from "chai";
import { capture, instance, mock } from "ts-mockito";

import { filterFromSkippedIds, YoutubeApp } from "../../src/apps/youtube";

chai.should();
const { expect } = chai;

const videoOf = (id: string) => ({
    desc: "",
    id,
    title: "stub",
});

describe("filterFromSkippedIds", () => {
    it("handles no skipped ids", () => {
        expect(filterFromSkippedIds(undefined)).to.be.undefined;
    });

    it("handles a single skipped id", () => {
        const filter = filterFromSkippedIds("skip-me");
        expect(filter).to.not.be.undefined;
        if (!filter) throw new Error();

        filter(videoOf("mreynolds")).should.be.true;
        filter(videoOf("skip-me")).should.be.false;
    });

    it("handles a series of skipped ids", () => {
        const filter = filterFromSkippedIds([
            "skip-me",
            "me-too",
        ]);
        expect(filter).to.not.be.undefined;
        if (!filter) throw new Error();

        filter(videoOf("mreynolds")).should.be.true;
        filter(videoOf("skip-me")).should.be.false;
        filter(videoOf("me-too")).should.be.false;
    });
});

describe("YoutubeApp", () => {

    describe("Playable creation", () => {
        it("supports skip query param", async () => {

            const listId = "PL1tiwbzkOjQz7D0l_eLJGAISVtcL7oRu_";
            const playable = await YoutubeApp.createPlayable(
                `https://www.youtube.com/playlist?list=${listId}&skip=skip-id`,
            );

            const App = mock(YoutubeApp);
            const app = instance(App);

            (app as any).youtubish = {}; // we have creds!

            await playable(app as any as YoutubeApp, {});

            const [ id, opts ] = capture(App.resumePlaylist).last();
            id.should.equal(listId);

            if (!opts) throw new Error();
            opts.should.have.property("filter").that.is.not.undefined;

            const { filter } = opts;
            if (!filter) throw new Error();

            filter(videoOf("skip-id")).should.be.false;
            filter(videoOf("play-id")).should.be.true;
        });

        it("supports multiple skip query params", async () => {

            const listId = "PL1tiwbzkOjQz7D0l_eLJGAISVtcL7oRu_";
            const playable = await YoutubeApp.createPlayable(
                `https://www.youtube.com/playlist?list=${listId}` +
                    `&skip=skip-id1` +
                    `&skip=skip-id2`,
            );

            const App = mock(YoutubeApp);
            const app = instance(App);

            (app as any).youtubish = {}; // we have creds!

            await playable(app as any as YoutubeApp, {});

            const [ id, opts ] = capture(App.resumePlaylist).last();
            id.should.equal(listId);

            if (!opts) throw new Error();
            opts.should.have.property("filter").that.is.not.undefined;

            const { filter } = opts;
            if (!filter) throw new Error();

            filter(videoOf("skip-id1")).should.be.false;
            filter(videoOf("skip-id2")).should.be.false;
            filter(videoOf("play-id")).should.be.true;
        });
    });

});
