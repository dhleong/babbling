import { ICredentials, ICredentialsManager } from "youtubish/dist/creds";
import { IVideo } from "youtubish/dist/model";

import { read, Token, write } from "../../token";

export function filterFromSkippedIds(
    ids: string | string[] | undefined,
) {
    if (!ids || !ids.length) return;

    if (typeof ids === "string") {
        return (video: IVideo) => video.id !== ids;
    }

    return (video: IVideo) => {
        for (const id of ids) {
            if (id === video.id) return false;
        }

        return true;
    };
}

export class TokenYoutubishCredsAdapter implements ICredentialsManager {
    constructor(
        private token: Token,
    ) { }

    public async get() {
        const cookies = read(this.token);
        if (cookies) {
            return { cookies };
        }
    }

    public async set(creds: ICredentials) {
        await write(this.token, creds.cookies);
    }
}
