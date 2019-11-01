import { IDevice } from "nodecastor";

import _debug from "debug";
const debug = _debug("babbling:device");

import { AppFor, IApp, IAppConstructor, OptionsFor, Opts } from "./app";
import { MediaControls } from "./controls";
import { findFirst } from "./scan";

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

    public async openControls() {
        const device = await this.getCastorDevice();
        return MediaControls.open(device);
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
        if (existing && !(existing as any)._stopped) {
            // NOTE: reaching into _stopped like this is hacky, but some APIs
            // like PlaybackTracker need to interact with the raw IDevice,
            // and so might change the state out from under us; if we don't
            // make sure the device is still connected, we can get into a bad
            // state where every connect request times out (since the channel
            // is actually closed)
            return existing;
        }

        const found = await findFirst(device => (
            !this.friendlyName // first-found
            || device.friendlyName === this.friendlyName
        ), this.timeout);
        this.castorDevice = found;
        return found;
    }
}
