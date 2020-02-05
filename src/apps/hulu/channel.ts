import _debug from "debug";
const debug = _debug("babbling:hulu:channel");

import {
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayerChannel,
    IQueryResult,
} from "../../app";

import { HuluApp, IHuluOpts } from ".";
import { HuluApi, supportedEntityTypes } from "./api";

const UUID_LENGTH = 36;

function seemsLikeValidUUID(uuid: string) {
    return /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/.test(uuid);
}

function createUrl(type: string, id: string) {
    return "https://www.hulu.com/" + type + "/" + id;
}

export class HuluPlayerChannel implements IPlayerChannel<HuluApp> {

    constructor(
        private readonly options: IHuluOpts,
    ) {}

    public ownsUrl(url: string) {
        return url.includes("hulu.com");
    }

    public async createPlayable(url: string) {
        if (url.length < UUID_LENGTH) {
            throw new Error(`'${url}' doesn't seem playable`);
        }

        const id = url.substr(-UUID_LENGTH);
        if (url.includes("/series/")) {
            debug("detected series", id);

            return async (app: HuluApp) => app.resumeSeries(id);
        }

        if (seemsLikeValidUUID(id)) {
            debug("detected some specific entity", id);
            return async (app: HuluApp) => app.play(id, {});
        }

        throw new Error(`Not sure how to play '${url}'`);
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        const api = new HuluApi(this.options);
        const url = item.url!;
        const seriesId = url.substring(url.lastIndexOf("/") + 1);

        const episode = await api.episodeResolver(seriesId).query(query);
        if (!episode) return;

        return {
            appName: "HuluApp",
            seriesTitle: item.title,
            title: episode.name,
            url: createUrl("watch", episode.id),

            playable: async (app: HuluApp) => {
                return app.play(episode.id, {});
            },
        };
    }

    public async *queryByTitle(
        title: string,
    ) {
        const results = await new HuluApi(this.options).search(title);
        for (const item of results) {
            if (item.actions.upsell) {
                continue;
            }

            const id = item.metrics_info.entity_id;
            const type = item.metrics_info.entity_type;
            if (!supportedEntityTypes.has(type)) {
                // skip!
                continue;
            }

            const url = "https://www.hulu.com/" + type + "/" + id;
            yield {
                appName: "HuluApp",
                desc: item.visuals.body.text,
                title: item.metrics_info.entity_name,
                url,

                playable: async (app: HuluApp) => {
                    if (type === "series") {
                        return app.resumeSeries(id);
                    }
                    return app.play(id, {});
                },
            };
        }
    }

    public async *queryRecommended() {
        const results = new HuluApi(this.options).fetchRecent();
        for await (const item of results) {
            const id = item.id;
            const type = item._type;
            if (!supportedEntityTypes.has(type)) {
                // skip!
                continue;
            }

            const url = createUrl(type, id);
            yield {
                appName: "HuluApp",
                cover: pickArtwork(item),
                desc: item.description,
                title: item.name,
                url,

                playable: async (app: HuluApp) => {
                    if (type === "series") {
                        return app.resumeSeries(id);
                    }
                    return app.play(id, {});
                },
            };
        }
    }
}

function pickArtwork(item: any) {
    if (!item.artwork) return;

    const obj = item.artwork["program.tile"];
    if (!(obj && obj.path)) return;

    return obj.path + "&operations=" + encodeURIComponent(JSON.stringify([
        { resize: "600x600|max" },
        { format: "jpeg" },
    ]));
}
