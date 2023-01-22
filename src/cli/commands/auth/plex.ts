import { PlexOauth, IPlexClientDetails } from "plex-oauth";
import { IPlexOpts } from "../../../apps/plex/config";
import generateMachineUuid from "../../../util/generateMachineUuid";

import { configInPath } from "../config";
import { consoleWrite } from "../util";
import { IAuthOpts } from "./config";

const clientInformation: IPlexClientDetails = {
    // NOTE: This will be overwritten by a random value below
    clientIdentifier: "io.github.dhleong.babbling",
    product: "babbling", // Name of your application
    device: "cli", // The type of device your application is running on
    version: "1", // Version of your application
    // forwardUrl: "https://localhost:3000", // Optional - Url to forward back to after signing in.
    platform: "Web", // Optional - Platform your application runs on - Defaults to 'Web'
    urlencode: true,
};

export async function login(opts: IAuthOpts) {
    // We generate a stable UUID based on the machine, to avoid re-auths filling
    // the user's account with new devices.
    const clientIdentifier = await generateMachineUuid();
    clientInformation.clientIdentifier = clientIdentifier;

    const oauth = new PlexOauth(clientInformation);
    const [oauthUrl, pinId] = await oauth.requestHostedLoginURL();
    consoleWrite("Open the following URL and login:\n");
    consoleWrite(oauthUrl);

    const retryDelayMs = 2500;
    const maxRetries = 120; // 5 minutes seems like more than enough time...
    const token = await oauth.checkForAuthToken(pinId, retryDelayMs, maxRetries);
    if (token == null) {
        throw new Error("Auth failed");
    }

    const config: IPlexOpts = {
        clientIdentifier,
        token,
    };
    await configInPath(opts.config, ["PlexApp"], config);
    consoleWrite("Success!");
}
