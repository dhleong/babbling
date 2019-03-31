import { CookieExtractor, LocalStorageExtractor } from "chromagnon";

import { IConfigurable } from "../../cli/model";

export interface IHboGoOpts {
    /**
     * The bearer token, as found in the Authorization header
     * for a request to `https://comet.api.hbo.com/content`
     */
    token: string;
}

export class HboGoConfigurable implements IConfigurable<IHboGoOpts> {
    public async extractConfig(
        cookies: CookieExtractor,
        storage: LocalStorageExtractor,
    ) {
        for await (const { key, value } of storage.readAll("https://play.hbogo.com")) {
            if (key.includes("LoginInfo.user")) {
                const entry = JSON.parse(value);
                const token = entry.accessToken;
                return { token };
            }
        }
    }
}
