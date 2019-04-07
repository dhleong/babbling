import debug_ from "debug";
const debug = debug_("babbling:babbler");

import { ICastSession, IDevice } from "nodecastor";
import { BaseApp, MEDIA_NS } from "./base";
import { awaitMessageOfType } from "./util";

const BABBLER_SESSION_NS = "urn:x-cast:com.github.dhleong.babbler";

export interface IBabblerOpts {
    appId: string;
    useLicenseIpc: boolean;
}

/**
 * Base class for apps that use Babbler for playback
 */
export class BabblerBaseApp extends BaseApp {
    constructor(
        device: IDevice,
        private babblerOpts: IBabblerOpts,
    ) {
        super(device, Object.assign({
            sessionNs: MEDIA_NS,
        }, babblerOpts));
    }

    public async start() {
        await super.start();

        if (this.babblerOpts.useLicenseIpc) {
            const s = await this.joinOrRunNamespace(BABBLER_SESSION_NS);
            s.on("message", m => {
                if (m.type === "LICENSE") {
                    this.handleLicenseRequest(s, m).catch(e => {
                        throw e;
                    });
                }
            });
        }
    }

    protected async loadUrl(
        url: string,
        licenseUrl?: string,
    ) {
        const s = await this.ensureCastSession();

        s.send({
            autoplay: true,
            customData: {
                license: {
                    ipc: this.babblerOpts.useLicenseIpc,
                    url: licenseUrl,
                },
            },
            media: {
                contentId: url,
                contentType: "video/mp4",
                streamType: "BUFFERED",

                // TODO metadata
            },
            sessionId: s.id,
            type: "LOAD",
        });

        let ms;
        do {
            ms = await awaitMessageOfType(s, "MEDIA_STATUS");
            debug(ms);
        } while (!ms.status.length);

        // TODO we might be able to stop after some
        // number of license requests; if not we need to
        // *hang* until playback stops
    }

    protected async performLicenseRequest(
        buffer: Buffer,
        url: string | undefined,
    ): Promise<Buffer> {
        throw new Error("performLicenseRequest not implemented");
    }

    private async handleLicenseRequest(s: ICastSession, message: any) {
        const { base64, url, requestId } = message;
        const buffer = Buffer.from(base64, "base64");

        debug("incoming perform license request");
        const response = await this.performLicenseRequest(buffer, url);

        s.send({
            response: response.toString("base64"),
            responseTo: requestId,
            type: "LICENSE_RESPONSE",
        });
    }

}
