import _debug from "debug";
const debug = _debug("babbling:hulu:channel");

import { IPlayerChannel } from "../../app";

import { HuluApp, IHuluOpts } from ".";
import { supportedEntityTypes, HuluApi } from "./api";

const UUID_LENGTH = 36;

function seemsLikeValidUUID(uuid: string) {
    return /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/.test(uuid);
}

export class HuluPlayerChannel implements IPlayerChannel<HuluApp> {

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

    public async *queryByTitle(
        title: string,
        opts: IHuluOpts,
    ) {

        const results = await new HuluApi(opts).search(title);
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
}
