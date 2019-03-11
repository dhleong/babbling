const nodecastor = require('nodecastor');
const debug = require('debug')('babbling:device');

const YoutubeApp = require('./apps/youtube');

const APP_CONSTRUCTORS = {
    youtube: YoutubeApp,
};

class ChromecastDevice {

    constructor(friendlyName, timeout) {
        this.friendlyName = friendlyName;
        this.timeout = timeout;
        if (timeout === undefined) {
            this.timeout = 10000;
        }
    }

    async openApp(appName) {
        const App = APP_CONSTRUCTORS[appName.toLowerCase()];
        if (!App) {
            throw new Error(`Unknown app '${appName}'`);
        }

        const device = await this._getCastorDevice();
        const app = new App(device);

        debug('Starting', App.name);
        await app.start();
        return app;
    }

    async _getCastorDevice() {
        return new Promise((resolve, reject) => {
            const scanner = nodecastor.scan();

            const timeoutId = setTimeout(() => {
                scanner.end();
                reject(new Error('Could not find device'));
            }, this.timeout);

            scanner.on('online', device => {
                if (!(
                    !this.friendlyName
                    || device.friendlyName === this.friendlyName
                )) {
                    // not found
                    return;
                }

                // found! clear timeout
                clearTimeout(timeoutId);

                // HACKS:
                scanner.browser.stop();

                debug('connecting to ', device.friendlyName);
                device.on('connect', () => {
                    debug('connected to ', device.friendlyName);
                    resolve(device);
                });
            });

            scanner.start();
        });
    }
}

module.exports = {
    ChromecastDevice,
};
