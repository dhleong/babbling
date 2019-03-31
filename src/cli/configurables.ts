import { CookieExtractor, LocalStorageExtractor } from "chromagnon";

import { IConfigurable } from "./model";

export interface ICookieConfig {
    cookies: string;
}

async function cookieString(c: CookieExtractor, url: string) {
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
        cookies: CookieExtractor,
        storage: LocalStorageExtractor,
    ): Promise<Partial<T> | undefined> {
        const s = await cookieString(cookies, this.url);
        if (s) {
            return { cookies: s } as Partial<T>;
        }
    }
}
