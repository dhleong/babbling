const util = require('util');
const debug = require('debug')('babbling:base');

class BaseApp {
    constructor(device, { appId, sessionNs }) {
        this.device = device;
        this.appId = appId;
        this.sessionNs = sessionNs;

        this._getApp = util.promisify(this.device.application.bind(device));
    }

    async start() {
        await this._ensureCastSession();
    }

    async _joinOrRunSession(app, ns) {
        debug('Got app', app.id, 'opening session....');

        let s;
        try {
            const appJoin = util.promisify(app.join.bind(app));
            s = await appJoin(ns);
        } catch (e) {
            debug('App not running; starting it up');
            const appRun = util.promisify(app.run.bind(app));
            s = await appRun(ns);
        }

        debug('Got session', s.id);
        return s;
    }

    async _ensureApp() {
        if (!this._app) {
            this._app = await this._getApp(this.appId);
        }

        if (!this._app) {
            throw new Error(`Couldn't get app ${this.appId}`);
        }

        return this._app;
    }

    async _ensureCastSession() {
        const app = await this._ensureApp();
        if (!this._session) {
            this._session = await this._joinOrRunSession(app, this.sessionNs);
        }

        if (!this._session) {
            throw new Error(`Could not get session ${this.sessionNs} for ${app.id}`);
        }

        return this._session;
    }
}

module.exports = BaseApp;
