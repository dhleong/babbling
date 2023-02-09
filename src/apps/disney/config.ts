import { IConfigSource, IConfigurable } from "../../cli/model";
import { Token } from "../../token";

export interface IDisneyOpts {
    token: Token;
    refreshToken: Token;
}

export class DisneyConfigurable implements IConfigurable<IDisneyOpts> {
    public async extractConfig(source: IConfigSource) {
        const stream = source.storage.readAll("https://www.disneyplus.com");
        for await (const { key, value } of stream) {
            if (key.startsWith("__bam_sdk_access--disney-svod")) {
                const entry = JSON.parse(value);
                const { token } = entry.context;
                const refreshToken = entry.context.tokenData.refresh_token;
                return { token, refreshToken };
            }
        }
    }
}
