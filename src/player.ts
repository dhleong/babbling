import _debug from "debug";
const debug = _debug("babbling:player");

import { AppFor, IApp, IPlayerEnabledConstructor, OptionsFor, Opts } from "./app";
import { ChromecastDevice } from "./device";

interface IConfiguredApp<TConstructor extends IPlayerEnabledConstructor<Opts, IApp>> {
    appConstructor: TConstructor;
    options: OptionsFor<TConstructor>;
}

function pickAppForUrl(
    apps: Array<IConfiguredApp<any>>,
    url: string,
) {
    for (const candidate of apps) {
        if (candidate.appConstructor.canPlayUrl(url)) {
            return candidate;
        }
    }

    throw new Error(`No configured app could play ${url}`);
}

class Player {
    constructor(
        private apps: Array<IConfiguredApp<any>>,
        private devices: ChromecastDevice[],
    ) {}

    public async playUrl(url: string) {
        const configured = pickAppForUrl(this.apps, url);
        debug("Chose", configured.appConstructor, "to play", url);

        const playable = await configured.appConstructor.createPlayable(url);
        debug("Successfully created player for", url);

        return await Promise.all(this.devices.map(async d => {
            const app = await d.openApp(
                configured.appConstructor,
                ...configured.options,
            );

            debug("Playing", url, "on", d.friendlyName);
            return playable(app);
        }));
    }
}

export class PlayerBuilder {

    private apps: Array<IConfiguredApp<any>> = [];
    private devices: ChromecastDevice[] = [];

    public withApp<TConstructor extends IPlayerEnabledConstructor<Opts, IApp>>(
        appConstructor: TConstructor,
        ...options: OptionsFor<TConstructor>  // tslint:disable-line
    ) {
        this.apps.push({
            appConstructor,
            options,
        });
        return this;
    }

    public addDevice(device: ChromecastDevice) {
        this.devices.push(device);
        return this;
    }

    public build() {
        if (!this.apps.length) {
            throw new Error("You must have at least one app enabled");
        }

        if (!this.devices.length) {
            throw new Error("You must have at least one device");
        }

        return new Player(this.apps, this.devices);
    }
}
