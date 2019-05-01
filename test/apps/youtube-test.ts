import * as chai from "chai";
import { capture, instance, mock } from "ts-mockito";

import request from "request-promise-native";

import {
    fillJar,
    filterFromSkippedIds,
    pruneCookies,
    YoutubeApp,
} from "../../src/apps/youtube";

chai.should();
const { expect } = chai;

const videoOf = (id: string) => ({
    desc: "",
    id,
    title: "stub",
});

describe("pruneCookies", () => {
    it("works when cookie is at the beginning", () => {
        expect(pruneCookies("S=youtube_lounge_remote=1234; LOGIN_INFO=login"))
            .to.equal("LOGIN_INFO=login");
    });

    it("works when cookie is at the end", () => {
        expect(pruneCookies("LOGIN_INFO=login; S=youtube_lounge_remote=1234"))
            .to.equal("LOGIN_INFO=login");
    });
});

describe("fillJar", () => {
    const URL = "https://www.firefly.com";
    it("parses all cookies in a Cookie header string", () => {
        const str = "captain=mreynolds; cargo=geisha-dolls";
        const jar = request.jar();
        fillJar(URL, jar, str);

        jar.getCookieString(URL).should.equal(str);
    });
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
