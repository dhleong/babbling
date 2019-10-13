import request from "request-promise-native";

import { PrimeApi } from "../../../apps/prime/api";
import { configInPath } from "../config";
import { consoleWrite, prompt } from "../util";
import { IAuthOpts } from "./config";

const OAUTH_URL = "https://api.amazon.com/auth/o2/token";
const CLIENT_ID = "amzn1.application-oa2-client.1a59cedc41344e8b9d7c7529a9352254";
const CLIENT_SECRET = "215c8685fc27ad5938e2d2275e9c55b63f3c529cbe2ce03cdf0e7cdb4c90cfc8";

// DEPRECATED, probably
export default async function authorize(code: string) {
    // nop
    const response = await request.post({
        url: OAUTH_URL,

        form: {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
        },
    });
    return response;
}

export async function login(opts: IAuthOpts, email: string) {
    const password = await prompt("password (not stored): ");
    if (!password) {
        consoleWrite("Prime Video auth canceled");
        return;
    }

    const api = new PrimeApi();
    const config = await api.login(email, password);
    await configInPath(opts.config, ["PrimeApp"], config);
    consoleWrite("Success!");
}
