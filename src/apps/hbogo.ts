import request from "request-promise-native";

import _debug from "debug";
const debug = _debug("babbling:hbogo");

import jwt from "jsonwebtoken";
import { IDevice } from "nodecastor";
import { BaseApp } from "./base";
import { awaitMessageOfType } from "./util";

const APP_ID = "144BDEF0";
const HBO_GO_NS = "urn:x-cast:hbogo";
const MEDIA_NS = "urn:x-cast:com.google.cast.media";

const TOKENS_URL = "https://comet.api.hbo.com/tokens";
const HBO_HEADERS = {
    "Accept": "application/vnd.hbo.v9.full+json",
    // tslint:disable-next-line
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36",
    "X-Hbo-Client-Version": "Hadron/21.0.1.176 desktop (DESKTOP)",
};

export interface IHboGoOpts {
    /**
     * The bearer token, as found in the Authorization header
     * for a request to `https://comet.api.hbo.com/content`
     */
    token: string;
}

export interface IHboGoPlayOptions {
    /** Eg "ENG" */
    language?: string;
    showSubtitles?: boolean;
}

export class HboGoApp extends BaseApp {

    private readonly token: string;

    constructor(device: IDevice, options: IHboGoOpts) {
        super(device, {
            appId: APP_ID,
            sessionNs: MEDIA_NS,
        });

        this.token = options.token.trim();
    }

    /**
     * Play a URN that looks like, eg:
     *   urn:hbo:episode:GVU3WpwOjOYNJjhsJAX5-
     */
    public async play(
        urn: string,
        options: IHboGoPlayOptions = {},
    ) {
        const {
            deviceId,
            userTkey,
        } = this.extractTokenInfo();

        const refreshToken = await this.loadRefreshToken();

        // stop other concurrent streams?
        await request.delete({
            headers: Object.assign(HBO_HEADERS, {
                Authorization: `Bearer ${refreshToken}`,
            }),
            url: "https://comet.api.hbo.com/concurrentStreams",
        });

        const s = await this.ensureCastSession();
        debug("Joined media session", s.id);

        const hbogo = await this.joinOrRunNamespace(HBO_GO_NS);

        s.send({
            autoplay: true,
            customData: {
                algorithm: "adaptive",
                authToken: {
                    refresh_token: refreshToken,
                },
                ccProperties: {
                    backgroundColor: "#000000",
                    backgroundOpacity: 0.33,
                    fontColor: "#FFFFFF",
                    fontFamily: 4,
                    fontOpacity: 1,
                    fontSize: 100,
                    fontStyle: "",
                },

                deviceId,
                displayCC: options.showSubtitles || false,
                featureTkey: urn,
                isExtra: false, // ?
                isFree: false, // ?
                isPreview: false, // ?
                language: options.language || "ENG",
                // position: 26.048875, // ?
                userTkey,

                // senderSessionId: "", // what should go here?
            },
            media: {
                contentId: urn,
                contentType: "video/mp4",
                streamType: "BUFFERED",
            },
            sessionId: s.id,
            type: "LOAD",
        });

        let ms;
        do {
            ms = await awaitMessageOfType(s, "MEDIA_STATUS");
            debug(ms);
        } while (!ms.status.length);

        let ps;
        do {
            ps = await awaitMessageOfType(hbogo, "PLAYERSTATE");
            debug(ps);
        } while (!ps.success);

        if (ps.playerState === "APPLICATION_ERROR") {
            throw new Error("Error");
        }

        debug("Done!");
    }

    private async loadRefreshToken() {
        // NOTE: I'm not sure if this step is 100% necessary, but
        // it may help to ensure refreshed tokens....

        const {
            clientId,
            deviceId,
        } = this.extractTokenInfo();

        // this step fetches some sort of session token that is *not*
        // logged in
        const baseTokens = await request.post({
            body: {
                client_id: clientId,
                client_secret: clientId,
                deviceSerialNumber: deviceId,
                grant_type: "client_credentials",
                scope: "browse video_playback_free",
            },
            headers: HBO_HEADERS,
            json: true,
            url: TOKENS_URL,
        });
        debug("baseTokens=", baseTokens);

        // now we exchange the session token above for an updated
        // refresh token
        const realTokens = await request.post({
            body: {
                grant_type: "refresh_token",
                refresh_token: this.token,
                scope: "browse video_playback device",
            },
            headers: Object.assign(HBO_HEADERS, {
                Authorization: `Bearer ${baseTokens.refresh_token}`,
            }),
            json: true,
            url: TOKENS_URL,
        });
        debug("Real Tokens:", realTokens);

        // make sure it worked
        if (!realTokens.isUserLoggedIn) {
            throw new Error("Not logged in...");
        }

        // TODO cache this until expired (see: expires_in)

        return realTokens.refresh_token;
    }

    private extractTokenInfo() {
        const tokenData = jwt.decode(this.token) as any;
        if (!tokenData || !tokenData.payload || !tokenData.payload.tokenPropertyData) {
            debug("Invalid token:", tokenData);
            debug("From:", this.token);
            throw new Error("Invalid token");
        }

        const data = tokenData.payload.tokenPropertyData;
        const { clientId, userTkey } = data;
        const deviceId = data.deviceSerialNumber;

        return {
            clientId,
            deviceId,
            userTkey,
        };
    }
}
