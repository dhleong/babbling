import { ICreds } from "youtubish";

import { CookiesConfigurable } from "../../cli/configurables";
import { Token } from "../../token";

export interface IYoutubeOpts {
    /**
     * A string of cookies as might be retrieved from the "copy as
     * cURL" from any request on youtube.com in Chrome's network
     * inspector. This will be provided for you if you use the
     * `auto-auth` CLI tool and `PlayerBuilder.autoInflate`.
     *
     * It is not necessary to provide both this *and* `youtubish`
     */
    cookies?: Token;

    /**
     * Credentials from Youtubish, as an alternative to `cookies`.
     * If you use the `auto-auth` CLI tool and `PlayerBuilder.autoInflate`
     * there is no need to use this; it is provided for convenience
     * with low-level, by-hand app init only.
     *
     * It is not necessary to provide both this *and* `cookies`.
     */
    youtubish?: ICreds;

    /**
     * The name of the "device" to show when we connect to the
     * Chromecast. It will be rendered simply as "<deviceName>" at the
     * top of the screen, or "<owner>'s <deviceName> has joined" if
     * `cookies` is provided
     */
    deviceName?: string;
}

export const YoutubeConfigurable = new CookiesConfigurable("https://www.youtube.com");
