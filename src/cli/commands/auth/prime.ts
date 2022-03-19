import { PrimeApi } from "../../../apps/prime/api";
import { configInPath } from "../config";
import { consoleWrite, prompt } from "../util";
import { IAuthOpts } from "./config";

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
