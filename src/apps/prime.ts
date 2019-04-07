import debug_ from "debug";
const debug = debug_("babbling:prime");

import { ChakramApi } from "chakram-ts";
import { IDevice } from "nodecastor";

import { BabblerBaseApp } from "./base-babbler";

export interface IPrimeOpts {
    appId: string;
    cookies: string;
}

/** fisher-yates shuffle */
function shuffle(a: any[]) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
}

/**
 * Amazon Prime Video
 */
export class PrimeApp extends BabblerBaseApp {
    private api: ChakramApi;

    constructor(
        device: IDevice,
        opts: IPrimeOpts,
    ) {
        super(device, {
            appId: opts.appId,
            useLicenseIpc: true,
        });

        this.api = new ChakramApi(opts.cookies);
    }

    public async playEpisode(
        id: string,
    ) {
        debug("play episode", id);
        const {
            manifests,
            licenseUrl,
        } = await this.api.getPlaybackInfo(id);

        // pick *some* manifest
        shuffle(manifests);

        const chosenUrl =  manifests[0].url;
        debug("got playback info; loading manifest @", chosenUrl);
        return this.loadUrl(
            chosenUrl,
            licenseUrl,
        );
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        if (!url) throw new Error("No license url provided");
        return this.api.fetchLicense(url, buffer);
    }
}
