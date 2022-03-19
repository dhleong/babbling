import { exchangeAuthCode } from "youtubish/dist/auth";
import { requestAuthCode } from "youtubish/dist/login";

import { configInPath } from "../config";
import { confirm, consoleWrite } from "../util";
import { IAuthOpts } from "./config";

export async function login(opts: IAuthOpts) {
    await confirm("A Chrome browser will be launched to authenticate with Google.");
    consoleWrite("Waiting for auth result...");

    const authCode = await requestAuthCode();
    consoleWrite("Generating credentials...");

    const info = await exchangeAuthCode(authCode);

    await configInPath(opts.config, ["YoutubeApp", "refreshToken"], info.refreshToken);
    if (info.access) {
        await configInPath(opts.config, ["YoutubeApp", "access"], JSON.stringify(info.access));
    }

    consoleWrite("Success!");
}
