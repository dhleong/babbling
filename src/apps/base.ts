import _debug from "debug";

import {
    ChromecastDevice,
    StratoApp,
    StratoChannel,
} from "stratocaster";

import { IApp } from "../app";

const debug = _debug("babbling:base");

export const MEDIA_NS = "urn:x-cast:com.google.cast.media";

export interface IBaseAppProps {
    appId: string;
    sessionNs: string;
}

export abstract class BaseApp implements IApp, IBaseAppProps {
    public appId: string;
    public sessionNs: string;

    private app: StratoApp | undefined;
    private session: StratoChannel | undefined;

    constructor(
        protected device: ChromecastDevice,
        props: IBaseAppProps,
    ) {
        this.appId = props.appId;
        this.sessionNs = props.sessionNs;
    }

    public async start() {
        await this.ensureCastSession();
    }

    protected async ensureCastSession() {
        await this.ensureApp();

        if (!this.session) {
            this.session = await this.joinOrRunNamespace(this.sessionNs);
        }

        return this.session;
    }

    protected async joinOrRunNamespace(ns: string) {
        const app = await this.ensureApp();

        const s = await this.joinOrRunSession(app, ns);
        if (!s) {
            throw new Error(`Could not get session ${ns} for ${app.id}`);
        }

        return s;
    }

    protected async requestStatus() {
        return this.device.getStatus();
    }

    private async ensureApp() {
        if (!this.app) {
            this.app = await this.device.app(this.appId);
        }

        if (!this.app) {
            throw new Error(`Couldn't get app ${this.appId}`);
        }

        return this.app;
    }

    private async joinOrRunSession(
        app: StratoApp, ns: string,
    ) {
        debug("Got app", app.id, "opening session....");

        const s = await app.channel(ns);

        debug("Got session", s);
        return s;
    }
}
