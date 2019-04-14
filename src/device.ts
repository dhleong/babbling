import nodecastor from "nodecastor";
import { IDevice } from "nodecastor";

import _debug from "debug";
const debug = _debug("babbling:device");

import { AppFor, IApp, IAppConstructor, OptionsFor, Opts } from "./app";

export class ChromecastDevice {

    private castorDevice: IDevice | null = null;

    constructor(
        public friendlyName: string,
        private timeout: number = 10000,
    ) { }

    /**
     * @param appConstructor The constructor of an App
     * @param options Will be provided as the 2nd+ args to
     * `appConstructor`, and are App-specific. See the relevant
     * constructor for more information on what is accepted here.
     */
    public async openApp<TConstructor extends IAppConstructor<Opts, IApp>>(
        appConstructor: TConstructor,
        ...options: OptionsFor<TConstructor>  // tslint:disable-line
    ): Promise<AppFor<TConstructor>> {
        const device = await this.getCastorDevice();
        const app = new appConstructor(
            device,
            ...options,
        ) as AppFor<TConstructor>;

        debug("Starting", appConstructor.name);
        await app.start();
        return app;
    }

    /**
     * Close any active connection to this device
     */
    public close() {
        const device = this.castorDevice;
        this.castorDevice = null;
        if (device) device.stop();
    }

    private async getCastorDevice(): Promise<IDevice> {
        const existing = this.castorDevice;
        if (existing) return existing;

        return new Promise((resolve, reject) => {
            let options;
            if (_debug.enabled("chromecast")) {
                options = {
                    logger: console,
                };
            }

            const scanner = nodecastor.scan(options);

            const timeoutId = setTimeout(() => {
                scanner.end();
                reject(new Error("Could not find device"));
            }, this.timeout);

            scanner.on("online", device => {
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

                debug("connecting to ", device.friendlyName);
                device.on("connect", () => {
                    debug("connected to ", device.friendlyName);
                    this.castorDevice = device;
                    resolve(device);
                });
            });

            scanner.start();
        });
    }
}
