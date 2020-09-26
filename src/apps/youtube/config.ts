import { ICreds } from "youtubish";

import { CookiesConfigurable } from "../../cli/configurables";
import { Token } from "../../token";

export interface IYoutubeCookieAuth {
    /**
     * A string of cookies as might be retrieved from the "copy as
     * cURL" from any request on youtube.com in Chrome's network
     * inspector. This will be provided for you if you use the
     * `auto-auth` CLI tool and `PlayerBuilder.autoInflate`.
     */
    cookies?: Token;
}

export interface IYoutubishAuth {
    /**
     * Credentials from Youtubish, as an alternative to `cookies` or
     * `refreshToken`.
     *
     * If you use the `auto-auth` CLI tool and `PlayerBuilder.autoInflate`
     * there is no need to use this; it is provided for convenience
     * with low-level, by-hand app init only.
     *
     * It is not necessary to provide both this *and* `cookies`.
     */
    youtubish: ICreds;
}

export interface IYoutubeOAuth {
    /**
     * A string token that can be used to generate cookies for
     * accessing youtube. This will be provided for you if you
     * use the `auth:youtube` CLI command and `PlayerBuilder.autoInflate`.
     */
    refreshToken: Token;
    access?: Token;
}

export type IYoutubeAuth = IYoutubeCookieAuth | IYoutubishAuth | IYoutubeOAuth;

export type IYoutubeOpts = IYoutubeAuth & {
    /**
     * The name of the "device" to show when we connect to the
     * Chromecast. It will be rendered simply as "<deviceName>" at the
     * top of the screen, or "<owner>'s <deviceName> has joined" if
     * `cookies` is provided
     */
    deviceName?: string;
}

export function isCookieAuth(auth: IYoutubeAuth | undefined): auth is IYoutubeCookieAuth {
    if (!auth) return false;
    return (auth as any).cookies;
}

export function isOauth(auth: IYoutubeAuth | undefined): auth is IYoutubeOAuth {
    if (!auth) return false;
    return (auth as any).refreshToken;
}

export function isYoutubish(auth: IYoutubeAuth | undefined): auth is IYoutubishAuth {
    if (!auth) return false;
    return (auth as any).youtubish;
}

export const YoutubeConfigurable = new CookiesConfigurable("https://www.youtube.com");
