import _debug from "debug";
const debug = _debug("babbling:player");

import { IApp, IPlayable, IPlayableOptions, IPlayerEnabledConstructor, IQueryResult, OptionsFor, Opts } from "./app";
import { mergeAsyncIterables } from "./async";
import { importConfig } from "./cli/config";
import { ChromecastDevice } from "./device";

interface IConfiguredApp<TConstructor extends IPlayerEnabledConstructor<Opts, IApp>> {
    appConstructor: TConstructor;
    options: OptionsFor<TConstructor>;
    autoConfigure?: boolean;
}

function pickAppForUrl(
    apps: Array<IConfiguredApp<IPlayerEnabledConstructor<any, any>>>,
    url: string,
) {
    for (const candidate of apps) {
        if (candidate.appConstructor.ownsUrl(url)) {
            return candidate;
        }
    }

    throw new Error(`No configured app could play ${url}`);
}

function findAppNamed(
    apps: Array<IConfiguredApp<IPlayerEnabledConstructor<any, any>>>,
    appName: string,
) {
    for (const candidate of apps) {
        if (candidate.appConstructor.name === appName) {
            return candidate;
        }
    }

    throw new Error(`Could not find configured app named ${appName}`);
}

export interface IPlayerOpts {
    /**
     * If true (the default) each device will be closed
     * automatically after each Player method call. Set
     * to false if you want to keep the connection alive.
     */
    autoClose?: boolean;
}

class Player {
    constructor(
        private apps: Array<IConfiguredApp<IPlayerEnabledConstructor<any, any>>>,
        private devices: ChromecastDevice[],
        private opts: IPlayerOpts,
    ) {}

    public async playUrl(url: string, opts: IPlayableOptions = {}) {
        const configured = pickAppForUrl(this.apps, url);
        debug("Chose", configured.appConstructor.name, "to play", url);

        const playable = await configured.appConstructor.createPlayable(
            url,
            ... configured.options,
        );
        debug("Successfully created player for", url);

        return this.playOnEachDevice(configured, playable, url, opts);
    }

    public async play(result: IQueryResult, opts: IPlayableOptions = {}) {
        const configured = findAppNamed(this.apps, result.appName);

        return this.playOnEachDevice(
            configured, result.playable, result.title, opts,
        );
    }

    public async *queryByTitle(title: string): AsyncIterable<IQueryResult> {
        const iterables = this.apps.filter(it => it.appConstructor.queryByTitle !== undefined)
            .map(it => it.appConstructor!.queryByTitle!(title, ...it.options));
        yield *mergeAsyncIterables(iterables);
    }

    private async playOnEachDevice(
        configured: IConfiguredApp<any>,
        playable: IPlayable<any>,
        label: string,
        opts: IPlayableOptions,
    ) {
        return this.withEachDevice(async d => {
            const app = await d.openApp(
                configured.appConstructor,
                ...configured.options,
            );

            debug("Playing", label, "on", d.friendlyName);
            await playable(app, opts);
        });
    }

    private async withEachDevice(
        block: (device: ChromecastDevice) => Promise<void>,
    ) {
        return Promise.all(this.devices.map(async d => {

            try {
                await block(d);
            } finally {
                if (this.opts.autoClose !== false) {
                    debug("auto-close", d.friendlyName);
                    d.close();
                }
            }

        }));
    }
}

export class PlayerBuilder {
    public static async autoInflate(configPath?: string) {
        const builder = new PlayerBuilder();

        for await (const [app, opts] of importConfig(configPath)) {
            builder.withApp(app, opts);
        }

        return builder;
    }

    private apps: Array<IConfiguredApp<any>> = [];
    private devices: ChromecastDevice[] = [];
    private opts: IPlayerOpts = {};

    public withApp<TConstructor extends IPlayerEnabledConstructor<Opts, IApp>>(
        appConstructor: TConstructor,
        ...options: OptionsFor<TConstructor>  // tslint:disable-line
    ) {
        const index = this.apps.findIndex(old => old.appConstructor === appConstructor);
        if (index !== -1) {
            // extend existing config, for use with autoInflate();
            this.apps[index].options = this.apps[index].options.map((old, i) => {
                return Object.assign({}, old, options[i]);
            });
        } else {
            this.apps.push({
                appConstructor,
                options,
            });
        }
        return this;
    }

    public addDevice(device: ChromecastDevice) {
        this.devices.push(device);
        return this;
    }

    public configure(opts: IPlayerOpts) {
        this.opts = opts;
        return this;
    }

    public build() {
        if (!this.apps.length) {
            throw new Error("You must have at least one app enabled");
        }

        if (!this.devices.length) {
            throw new Error("You must have at least one device");
        }

        return new Player(this.apps, this.devices, this.opts);
    }
}
