import _debug from "debug";

import { ChromecastDevice as StratoDevice } from "stratocaster";

import {
    AppFor, IApp, IAppConstructor, OptionsFor, Opts,
} from "./app";
import { MediaControls } from "./controls";

const debug = _debug("babbling:device");

export class ChromecastDevice {
    private readonly castorDevice: StratoDevice;

    constructor(
        public friendlyName: string,
        timeout = 10000,
    ) {
        this.castorDevice = new StratoDevice(friendlyName, {
            searchTimeout: timeout,
        });
    }

    /**
     * Detect if the device exists, returning information about
     * the device if it does, or null if it doesn't.
     */
    public async detect() {
        try {
            const d = await this.castorDevice.getServiceDescriptor();

            return {
                friendlyName: d.name,
                id: d.id,
                model: d.model,
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * @param AppConstructor The constructor of an App
     * @param options Will be provided as the 2nd+ args to
     * `appConstructor`, and are App-specific. See the relevant
     * constructor for more information on what is accepted here.
     */
    public async openApp<TConstructor extends IAppConstructor<Opts, IApp>>(
        AppConstructor: TConstructor,
        ...options: OptionsFor<TConstructor>
    ): Promise<AppFor<TConstructor>> {
        const app = new AppConstructor(
            this.castorDevice,
            ...options,
        ) as AppFor<TConstructor>;

        debug("Starting", AppConstructor.name);
        await app.start();
        return app;
    }

    public async openControls() {
        return MediaControls.open(this.castorDevice);
    }

    /**
     * Close any active connection to this device
     */
    public close() {
        this.castorDevice.close();
    }
}
