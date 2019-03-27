import * as util from "util";

import _debug from "debug";
const debug = _debug("babbling:base");

import { ICastApp, ICastSession, IDevice } from "nodecastor";
import { IApp } from "../app";

export interface IBaseAppProps {
    appId: string;
    sessionNs: string;
}

export abstract class BaseApp implements IApp, IBaseAppProps {
    public appId: string;
    public sessionNs: string;

    private getApp: (id: string) => Promise<ICastApp>;
    private app: ICastApp | undefined;
    private session: ICastSession | undefined;

    constructor(
        private device: IDevice,
        props: IBaseAppProps,
    ) {
        this.appId = props.appId;
        this.sessionNs = props.sessionNs;

        this.getApp = util.promisify(device.application.bind(device));
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
        const loadStatus = util.promisify((this.device as any).status.bind(this.device));
        return loadStatus();
    }

    private async ensureApp() {
        if (!this.app) {
            this.app = await this.getApp(this.appId);
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
            const appJoin = util.promisify(app.join.bind(app));
            s = await appJoin(ns);
        } catch (e) {
            debug("App not running; starting it up");
            const appRun = util.promisify(app.run.bind(app));
            s = await appRun(ns);
        }

        debug("Got session", s.id);
        return s;
    }
}
