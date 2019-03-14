const nodecastor = require('nodecastor');
const debug = require('debug')('babbling:device');

class ChromecastDevice {

    constructor(friendlyName, timeout) {
        this.friendlyName = friendlyName;
        this.timeout = timeout;
        if (timeout === undefined) {
            this.timeout = 10000;
        }
    }

    /**
     * @param appConstructor The constructor of an App
     * @param options Will be provided as the 2nd+ args to
     * `appConstructor`, and are App-specific. See the relevant
     * constructor for more information on what is accepted here.
     */
    async openApp(appConstructor, ...options) {
        const device = await this._getCastorDevice();
        const app = new appConstructor(device, ...options);

        debug('Starting', appConstructor.name);
        await app.start();
        return app;
    }

    close() {
        const device = this._castorDevice;
        this._castorDevice = null;
        if (device) device.stop();
    }

    async _getCastorDevice() {
        return new Promise((resolve, reject) => {
            const existing = this._castorDevice;
            if (existing) {
                resolve(existing);
                return;
            }

            let options;
            if (debug.enabled) {
                options = {
                    logger: console,
                };
            }

            const scanner = nodecastor.scan(options);

            const timeoutId = setTimeout(() => {
                scanner.end();
                reject(new Error('Could not find device'));
            }, this.timeout);

            scanner.on('online', device => {
                if (!(
                    !this.friendlyName
                    || device.friendlyName === this.friendlyName
                )) {
                    // not interested in this device
                    device.stop();
                    return;
                }

                // found! clear timeout
                clearTimeout(timeoutId);

                // HACKS:
                try {
                    scanner.end();
                } catch (e) {
                    scanner.browser.stop();
                }

                debug('connecting to ', device.friendlyName);
                device.on('connect', () => {
                    debug('connected to ', device.friendlyName);
                    this._castorDevice = device;
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
