import { IConfigSource, IConfigurable } from "../../cli/model";
import { Token } from "../../token";

export interface IHboGoOpts {
    /**
     * The bearer token, as found in the Authorization header
     * for a request to `https://comet.api.hbo.com/content`
     */
    token: Token;
}

export class HboGoConfigurable implements IConfigurable<IHboGoOpts> {
    public async extractConfig(
        source: IConfigSource,
    ) {
        const stream = source.storage.readAll("https://play.hbogo.com");
        for await (const { key, value } of stream) {
            if (key.includes("LoginInfo.user")) {
                const entry = JSON.parse(value);
                const token = entry.accessToken;
                return { token };
            }
        }
    }
}
