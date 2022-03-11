import _debug from "debug";
const debug = _debug("babbling:player");

import {
    IApp,
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayable,
    IPlayableOptions,
    IPlayerChannel,
    IPlayerEnabledConstructor,
    IQueryResult,
    OptionsFor,
    Opts,
} from "./app";
import { interleaveAsyncIterables, mergeAsyncIterables } from "./async";
import { importConfig } from "./cli/config";
import { ChromecastDevice } from "./device";

type IAppOf<T> =
    T extends IPlayerEnabledConstructor<infer TOpt, infer TApp> ? TApp :
    never;

interface IConfiguredApp<TConstructor extends IPlayerEnabledConstructor<Opts, IApp>> {
    appConstructor: TConstructor;
    channel: IPlayerChannel<IAppOf<TConstructor>>;
    options: OptionsFor<TConstructor>;
    autoConfigure?: boolean;
}

export type AppSpecificErrorHandler = (app: string, e: Error) => void;
const defaultAppSpecificErrorHandler: AppSpecificErrorHandler =
    (app, e) => { throw e; };

function pickAppForUrl(
    apps: Array<IConfiguredApp<IPlayerEnabledConstructor<any, any>>>,
    url: string,
) {
    for (const candidate of apps) {
        if (candidate.channel.ownsUrl(url)) {
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

        const playable = await configured.channel.createPlayable(url);
        debug("Successfully created player for", url);

        return this.playOnEachDevice(configured, playable, url, opts);
    }

    public async play(result: IQueryResult, opts: IPlayableOptions = {}) {
        const configured = findAppNamed(this.apps, result.appName);

        return this.playOnEachDevice(
            configured, result.playable, result.title, opts,
        );
    }

    public async findEpisodeFor(
        item: IQueryResult,
        query: IEpisodeQuery,
    ): Promise<IEpisodeQueryResult | undefined> {
        const configured = findAppNamed(this.apps, item.appName);
        if (configured.channel.findEpisodeFor) {
            return configured.channel.findEpisodeFor(item, query);
        }

        // fallback to a default implementation if
        // queryEpisodeForTitle is provided
        if (configured.channel.queryEpisodeForTitle) {
            const results = configured.channel.queryEpisodeForTitle(
                item.title,
                query,
            );
            for await (const episode of results) {
                if (episode.seriesTitle === item.title) {
                    return episode;
                }
            }
        }
    }

    /**
     * Get an AsyncIterable representing playables from across all
     * configured apps. Each result can be passed directly to `play`.
     *
     * @param title The title to search for
     * @param onError Handler for when an app encounters an error. By
     *                default, the error will just be thrown eagerly,
     *                but you may prefer to simply log the error and
     *                allow the other apps to provide their results
     */
    public queryByTitle(
        title: string,
        onError: AppSpecificErrorHandler = defaultAppSpecificErrorHandler,
    ): AsyncIterable<IQueryResult> {
        const iterables = this.apps.map(async function*(app) {
            if (!app.channel.queryByTitle) return;

            try {
                yield *app.channel.queryByTitle(title);
            } catch (e: any) {
                onError(app.appConstructor.name, e);
            }
        });

        return mergeAsyncIterables(iterables);
    }

    /**
     * Get an AsyncIterable representing playables from across all
     * configured apps. Each result can be passed directly to `play`.
     * Returned IQueryResult instances represent a specific episode
     * in a Series that matches the given title
     *
     * @param title The title to search for
     * @param query A description of the desired episode to play
     * @param onError Handler for when an app encounters an error. By
     *                default, the error will just be thrown eagerly,
     *                but you may prefer to simply log the error and
     *                allow the other apps to provide their results
     */
    public queryEpisodeForTitle(
        title: string,
        query: IEpisodeQuery,
        onError: AppSpecificErrorHandler = defaultAppSpecificErrorHandler,
    ): AsyncIterable<IEpisodeQueryResult> {
        const iterables = this.apps.map(async function*(app) {
            if (!app.channel.queryEpisodeForTitle) {
                // fallback to a default implementation if findEpisodeFor
                // is provided
                if (app.channel.queryByTitle && app.channel.findEpisodeFor) {
                    for await (const series of app.channel.queryByTitle(title)) {
                        const episode = await app.channel.findEpisodeFor(series, query);
                        if (episode) yield episode;
                    }
                }
                return;
            }

            try {
                yield *app.channel.queryEpisodeForTitle(title, query);
            } catch (e: any) {
                onError(app.appConstructor.name, e);
            }
        });

        return mergeAsyncIterables(iterables);
    }

    /**
     * Get a map each key is the name of an App and each value is an
     * AsyncIterable representing recommended media from that app. Each result
     * can be passed directly to `play`.
     */
    public getRecommendationsMap() {
        return this.apps.reduce((m, app) => {
            if (!app.channel.queryRecommended) return m;

            m[app.appConstructor.name] = app.channel.queryRecommended();
            return m;
        }, {} as {[app: string]: AsyncIterable<IQueryResult>});
    }

    /**
     * Get an AsyncIterable representing playables from across all
     * configured apps. Each result can be passed directly to `play`.
     *
     * @param onError Handler for when an app encounters an error. By
     *                default, the error will just be thrown eagerly,
     *                but you may prefer to simply log the error and
     *                allow the other apps to provide their results
     */
    public queryRecommended(
        onError: AppSpecificErrorHandler = defaultAppSpecificErrorHandler,
    ) {
        const m = this.getRecommendationsMap();
        const iterables = Object.keys(m).map(async function*(appName) {
            const results = m[appName];
            try {
                yield *results;
            } catch (e: any) {
                onError(appName, e);
            }
        });

        return interleaveAsyncIterables(iterables);
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
                channel: appConstructor.createPlayerChannel(...options),
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
