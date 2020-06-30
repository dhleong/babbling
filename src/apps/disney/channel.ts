import _debug from "debug";
const debug = _debug("babbling:DisneyApp:channel");

import {
    // IEpisodeQuery,
    // IEpisodeQueryResult,
    IPlayableOptions,
    IPlayerChannel,
    IQueryResult,
} from "../../app";

// NOTE: this sure looks like a circular dependency, but we're just
// importing it for the type definition
import { DisneyApp, IDisneyOpts } from ".";
import { DisneyApi } from "./api";

const PLAYBACK_URL = "https://www.disneyplus.com/video/";
const SERIES_URL = "https://www.disneyplus.com/series/";

export class DisneyPlayerChannel implements IPlayerChannel<DisneyApp> {

    private readonly api: DisneyApi;

    constructor(
        readonly options: IDisneyOpts,
    ) {
        this.api = new DisneyApi(options);
    }

    public ownsUrl(url: string): boolean {
        return url.includes("disneyplus.com");
    }

    public async createPlayable(url: string) {
        // other urls?
        const videoMatch = url.match(/\/video\/(.+)$/);
        if (videoMatch && videoMatch[1]) {
            const id = videoMatch[1];

            return async (app: DisneyApp, opts: IPlayableOptions) => {
                await app.playById(id);
            };
        }

        const seriesMatch = url.match(/\/series\/[^\/]+\/(.+)$/);
        if (seriesMatch && seriesMatch[1]) {
            const seriesId = seriesMatch[1];

            return async (app: DisneyApp, opts: IPlayableOptions) => {
                // TODO: this probably belongs in the app:
                debug("find resume for series", seriesId);

                const resume = await this.api.pickResumeEpisodeForSeries(seriesId);
                debug("... resume:", resume);
                await app.playById(resume.contentId);
            };
        }

        throw new Error(`Unsure how to play ${url}`);
    }

    /**
     * Search for {@see Player.play}'able media by title
     */
    public async *queryByTitle(
        title: string,
    ): AsyncIterable<IQueryResult> {
        const results = await this.api.search(title);

        for (const result of results) {
            const id = result.contentId;
            const titleObj = result.texts.find(item => {
                return item.field === "title" && item.type === "full";
            });
            const descObj = result.texts.find(item => {
                return item.field === "description" && item.type === "full";
            });

            if (!titleObj) continue;

            let url: string;
            if (result.encodedSeriesId) {
                const slugObj = result.texts.find(item => {
                    return item.field === "title" && item.type === "slug";
                });
                url = SERIES_URL + slugObj!!.content + "/" + result.encodedSeriesId;
            } else {
                url = PLAYBACK_URL + id;
            }

            yield {
                appName: "DisneyApp",
                desc: descObj ? descObj.content : undefined,
                title: titleObj.content,
                url,

                playable: await this.createPlayable(url),
            };
        }
    }

}
