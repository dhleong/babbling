import _debug from "debug";
const debug = _debug("babbling:base");

import { IApp } from "../app";
import { ICastApp, ICastSession, IDevice } from "../cast";
import { getApp, promise } from "./util";

export const MEDIA_NS = "urn:x-cast:com.google.cast.media";

export interface IBaseAppProps {
    appId: string;
    sessionNs: string;
}

export abstract class BaseApp implements IApp, IBaseAppProps {
    public appId: string;
    public sessionNs: string;

    private app: ICastApp | undefined;
    private session: ICastSession | undefined;

    constructor(
        protected device: IDevice,
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
        return promise(this.device, this.device.status);
    }

    private async ensureApp() {
        if (!this.app) {
            this.app = await getApp(this.device, this.appId);
        }

        if (!this.app) {
            throw new Error(`Couldn't get app ${this.appId}`);
        }

        return this.app;
    }

    private async joinOrRunSession(
        app: ICastApp, ns: string,
    ) {
        debug("Got app", app.id, "opening session....");

        let s: ICastSession;
        try {
            s = await promise(app, app.join, ns);
        } catch (e) {
            debug("App not running; starting it up");
            s = await promise(app, app.run, ns);
        }

        debug("Got session", s.id);
        return s;
    }
}
