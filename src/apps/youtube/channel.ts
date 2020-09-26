import _debug from "debug";
const debug = _debug("babbling:youtube:channel");

import URL from "url";

import { IPlayableOptions, IPlayerChannel } from "../../app";

import { IYoutubeOpts, YoutubeApp } from ".";
import { filterFromSkippedIds } from "./util";
import { hasAuth } from "./config";

export class YoutubePlayerChannel implements IPlayerChannel<YoutubeApp> {

    constructor(
        private readonly options: IYoutubeOpts,
    ) {}

    public ownsUrl(url: string) {
        return url.includes("youtube.com") || url.includes("youtu.be");
    }

    /**
     * Extra query params supported:
     * - `skip`: ID of a video to "skip" when attempting to resume
     *   a playlist. May be passed multiple times
     */
    public async createPlayable(url: string) {
        let videoId = "";
        let listId = "";
        let listIndex = -1;
        let startTime = -1;

        const parsed = URL.parse(url, true);

        if (url.startsWith("youtu.be")) {
            videoId = url.substring(url.lastIndexOf("/") + 1);
            debug("got short URL video id", videoId);
        } else if (parsed.query.v) {
            videoId = parsed.query.v as string;
            debug("got video id", videoId);
        }

        if (parsed.query.list) {
            listId = parsed.query.list as string;
            debug("extracted listId", listId);

            // watch later requires auth
            if (listId === "WL" && !(this.options && hasAuth(this.options))) {
                throw new Error("Cannot use watch later playlist without cookies or refreshToken");
            }

            if (parsed.query.index) {
                listIndex = parseInt(parsed.query.index.toString(), 10);
            }
        }

        if (parsed.query.t) {
            startTime = parseInt(parsed.query.t as string, 10);
            debug("detected start time", startTime);
        }

        if (listId === "" && videoId === "") {
            throw new Error(`Not sure how to play '${url}'`);
        }

        return async (app: YoutubeApp, opts: IPlayableOptions) => {
            if (
                opts.resume !== false
                && app.isAuthenticated()
                && listId !== ""
                && videoId === ""
            ) {
                const filter = filterFromSkippedIds(parsed.query.skip);
                if (listIndex >= 0) {
                    return app.playPlaylist(listId, {
                        filter,
                        index: listIndex,
                    });
                }

                return app.resumePlaylist(listId, {
                    filter,
                });
            }

            return app.play(videoId, {
                listId,
                startTime,
            });
        };
    }
}
