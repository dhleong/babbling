import { CookieExtractor, LocalStorageExtractor } from "chromagnon";
import { ICreds } from "youtubish";

import { CookiesConfigurable } from "../../cli/configurables";
import { IConfigSource, IConfigurable } from "../../cli/model";

export interface IPlaylistCache {
    [id: string]: any;
}

export interface IYoutubeOpts {
    /**
     * A string of cookies as might be retrieved from the "copy as
     * cURL" from any request on youtube.com in Chrome's network
     * inspector
     */
    cookies?: string;

    /**
     * Credentials from Youtubish
     */
    youtubish?: ICreds;

    /**
     * Optional cache storage for playlist data, when youtubish
     * credentials are provided for resuming playlists. If not
     * provided, playlists will be fetched for each request.
     *
     * It is recommended to use the cache for long-running
     * processes
     */
    playlistsCache?: IPlaylistCache;

    /**
     * The name of the "device" to show when we connect to the
     * Chromecast. It will be rendered simply as "<deviceName>" at the
     * top of the screen, or "<owner>'s <deviceName> has joined" if
     * `cookies` is provided
     */
    deviceName?: string;
}

const baseConfigurable = new CookiesConfigurable("https://www.youtube.com");

export class YoutubeConfigurable implements IConfigurable<IYoutubeOpts> {
    public async extractConfig(
        source: IConfigSource,
    ) {
        const base = await baseConfigurable.extractConfig(source);
        if (!base || !base.cookies) return;

        return {
            cookies: base.cookies,
            youtubish: base as { cookies: string },
        };
    }
}
