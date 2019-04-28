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
        return new MediaControls(device);
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

        const found = await findFirst(device => (
            !this.friendlyName // first-found
            || device.friendlyName === this.friendlyName
        ), this.timeout);
        this.castorDevice = found;
        return found;
    }
}
