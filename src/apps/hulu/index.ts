import _debug from "debug";

import { ChromecastDevice, isJson } from "stratocaster";

import { CookiesConfigurable } from "../../cli/configurables";
import { BaseApp } from "../base";

import { HuluApi } from "./api";
import { HuluPlayerChannel } from "./channel";
import { IHuluOpts } from "./config";

const debug = _debug("babbling:hulu");

export { IHuluOpts } from "./config";

const APP_ID = "3EC252A5";
const HULU_PLUS_NS = "urn:x-cast:com.hulu.plus";

function eabIdFromEntity(entity: any) {
    if (entity.bundle && entity.bundle.eab_id) {
        return entity.bundle.eab_id;
    }
    const contentId = entity.content_id || "NULL";
    const bundleId = entity.bundle ? entity.bundle.id : "NULL";
    return `EAB::${entity.id}::${contentId}::${bundleId}`;
}

export class HuluApp extends BaseApp {
    public static configurable = new CookiesConfigurable<IHuluOpts>("https://www.hulu.com");
    public static createPlayerChannel(options: IHuluOpts) {
        return new HuluPlayerChannel(options);
    }

    private readonly api: HuluApi;
    private readonly captionsLanguage: string | undefined;

    constructor(device: ChromecastDevice, options: IHuluOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: HULU_PLUS_NS,
        });

        this.api = new HuluApi(options);
        if (options) {
            const { captionsLanguage } = options;
            this.captionsLanguage = captionsLanguage;
        }
    }

    /**
     * Options:
     * - startTime: Time in seconds to start playback. Defaults to
     *              resuming the episode (maybe?)
     */
    public async play(
        videoId: string,
        { startTime }: {
            startTime?: number,
        },
    ) {
        const extraData = {} as any;
        if (startTime) {
            extraData.offset_msec = startTime * 1000;
        }

        return this.playEntity(
            this.api.loadEntityById(videoId),
            extraData,
        );
    }

    /**
     * Attempt to play the "next" episode for the given series.
     */
    public async resumeSeries(seriesId: string) {
        return this.playEntity(
            this.api.findNextEntityForSeries(seriesId),
            {},
        );
    }

    private async playEntity(
        entityPromise: Promise<any>,
        extraData: {
            offset_msec?: number,
        },
    ) {
        const [userToken, s, entity] = await Promise.all([
            this.api.getUserToken(),
            this.ensureCastSession(),
            entityPromise,
        ]);

        const data = {
            autoplay: {
                autoplay: "on",
            },
            caption_style_data: {
                background_color: 2130706432,
                edge_color: 0,
                edge_type: "dropshadow",
                font_family: "Arial",
                text_color: 4294967295,
                text_size: 0.7777777777777778,
            },
            captions_language: this.captionsLanguage || "off",
            eab_id: eabIdFromEntity(entity),
            entity,
            expiration_time: 43200000,
            latitude: -1,
            limit_ad_tracking: true,
            longitude: -1,
            profile: {
                profile_id: this.api.profileId,
            },
            show_prerolls: true,
            user_id: this.api.userId,
            user_token: userToken,
            ...extraData,
        };

        s.write({
            data,
            event_type: "start",
            message_id: 1,
        });
        debug("sent START message");

        for await (const m of s.receive()) {
            if (!isJson(m.data)) continue;
            if (m.data.event_type !== "playback_update") continue;

            const { playback_state } = m.data.data as any;
            if (playback_state && playback_state.length && playback_state[0] === "PLAYING") {
                debug(m.data.data);
                break;
            }
        }
    }
}
