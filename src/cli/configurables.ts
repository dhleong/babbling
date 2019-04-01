import { IConfigSource, IConfigurable, ICookieSource } from "./model";

export interface ICookieConfig {
    cookies: string;
}

async function cookieString(c: ICookieSource, url: string) {
    let str = "";

    for await (const cookie of c.query(url)) {
        if (str.length) {
            str += "; ";
        }

        str += `${cookie.name}=${cookie.value}`;
    }

    return str;
}

export class CookiesConfigurable<T extends ICookieConfig> implements IConfigurable<T> {
    constructor(private url: string) {}

    public async extractConfig(
        source: IConfigSource,
    ): Promise<Partial<T> | undefined> {
        const s = await cookieString(source.cookies, this.url);
        if (s) {
            return { cookies: s } as Partial<T>;
        }
    }
}
