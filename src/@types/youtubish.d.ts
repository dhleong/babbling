/// <reference types="node" />
// NOTE at some point I'll probably just convert youtubish to
// typescript...
// tslint:disable:max-classes-per-file

declare module "youtubish" {
    export interface IFilledCreds {
        apiKey: string;
        cookies: string;
    }

    export type ICredsPromise = Promise<IFilledCreds>;

    export type ICreds = IFilledCreds | ICredsPromise;

    export interface IVideo {
        id: string;
    }

    export class WatchHistory {
        constructor(creds: ICreds);
    }

    export class YoutubePlaylist {
        constructor(creds: ICreds, id: string);

        public findMostRecentlyPlayed(
            history: WatchHistory,
        ): Promise<IVideo>;
    }
}
