import _debug from "debug";

import {
    IApp,
    IEpisodeQuery,
    IEpisodeQueryResult,
    IPlayable,
    IPlayableOptions,
    IPlayerChannel,
    IPlayerEnabledConstructor,
    IQueryResult,
    IRecommendationQuery,
    OptionsFor,
    Opts,
} from "./app";
import { interleaveAsyncIterables, mergeAsyncIterables } from "./async";
import { importConfig } from "./cli/config";
import { ChromecastDevice } from "./device";

const debug = _debug("babbling:player");

type IAppOf<T> = T extends IPlayerEnabledConstructor<any, infer TApp>
    ? TApp
    : never;

interface IConfiguredApp<
    TConstructor extends IPlayerEnabledConstructor<Opts, IApp>,
> {
    appConstructor: TConstructor;
    channel: IPlayerChannel<IAppOf<TConstructor>>;
    options: OptionsFor<TConstructor>;
    autoConfigure?: boolean;
}

export type AppSpecificErrorHandler = (app: string, e: Error) => void;
const defaultAppSpecificErrorHandler: AppSpecificErrorHandler = (app, e) => {
    throw e;
};

export interface IQueryOptions {
    /**
     * Handler for when an app encounters an error. By default, the error will
     * just be thrown eagerly, but you may prefer to simply log the error and allow
     * the other apps to provide their results
     */
    onError?: AppSpecificErrorHandler;
}

type FilledQueryOptions = Required<IQueryOptions>;

type QueryOptions = AppSpecificErrorHandler | IQueryOptions;

function unpackQueryOptions(
    input: QueryOptions | undefined,
): FilledQueryOptions {
    const onError =
        input == null || typeof input === "function"
            ? input
            : (input as FilledQueryOptions).onError;

    return {
        onError: onError ?? defaultAppSpecificErrorHandler,
    };
}

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

export class Player {
    constructor(
        private apps: Array<
            IConfiguredApp<IPlayerEnabledConstructor<any, any>>
        >,
        private devices: ChromecastDevice[],
        private opts: IPlayerOpts,
    ) {}

    public buildUpon() {
        // NOTE: We create and clone a PlayerBuilder to ensure that mutations of
        // the resulting Builder do not also mutate this object.
        // NOTE: It should be safe to use this here; Player will not be
        // constructed in this file and, in general, should only be constructed
        // via PlayerBuilder anyway
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return new PlayerBuilder(this.apps, this.devices, this.opts).clone();
    }

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
            configured,
            result.playable,
            result.title,
            opts,
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
     */
    public queryByTitle(
        title: string,
        options?: QueryOptions,
    ): AsyncIterable<IQueryResult> {
        const { onError } = unpackQueryOptions(options);
        const iterables = this.apps.map(async function* iterable(app) {
            if (!app.channel.queryByTitle) return;

            try {
                yield* app.channel.queryByTitle(title);
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
     */
    public queryEpisodeForTitle(
        title: string,
        query: IEpisodeQuery,
        options?: QueryOptions,
    ): AsyncIterable<IEpisodeQueryResult> {
        const { onError } = unpackQueryOptions(options);
        const iterables = this.apps.map(async function* iterable(app) {
            if (!app.channel.queryEpisodeForTitle) {
                // fallback to a default implementation if findEpisodeFor
                // is provided
                if (app.channel.queryByTitle && app.channel.findEpisodeFor) {
                    for await (const series of app.channel.queryByTitle(
                        title,
                    )) {
                        const episode = await app.channel.findEpisodeFor(
                            series,
                            query,
                        );
                        if (episode) yield episode;
                    }
                }
                return;
            }

            try {
                yield* app.channel.queryEpisodeForTitle(title, query);
            } catch (e: any) {
                onError(app.appConstructor.name, e);
            }
        });

        return mergeAsyncIterables(iterables);
    }

    /**
     * Get a map where each key is the name of an App and each value is an
     * AsyncIterable representing recommended media from that app. Each result
     * can be passed directly to `play`.
     * @deprecated Use getQueryRecommendationsMap instead.
     */
    public getRecommendationsMap(options?: QueryOptions) {
        return this.getDeprecatedRecommendationsMap(options);
    }

    /**
     * Get an AsyncIterable representing playables from across all
     * configured apps. Each result can be passed directly to `play`.
     * @deprecated
     */
    public queryRecommended(options?: QueryOptions) {
        const m = this.getDeprecatedRecommendationsMap(options);
        return interleaveAsyncIterables(Object.values(m));
    }

    private getDeprecatedRecommendationsMap(options?: QueryOptions) {
        return this.buildQueryMap(options, (app) =>
            app.channel.queryRecommended?.bind(app.channel),
        );
    }

    /**
     * Get a map where each key is the name of an App and each value is an
     * AsyncIterable representing recommended media from that app. Each result
     * can be passed directly to `play`.
     * @see [IPlayerChannel.queryRecommendations]
     */
    public getQueryRecommendationsMap(
        query?: IRecommendationQuery,
        options?: QueryOptions,
    ) {
        return this.buildQueryMap(options, (app) =>
            app.channel.queryRecommendations?.bind(app.channel, query),
        );
    }

    /**
     * Get an AsyncIterable representing playables from across all
     * configured apps. Each result can be passed directly to `play`.
     */
    public queryRecommendations(
        query?: IRecommendationQuery,
        options?: QueryOptions,
    ) {
        const m = this.getQueryRecommendationsMap(query, options);
        return interleaveAsyncIterables(Object.values(m));
    }

    /**
     * Get a map each key is the name of an App and each value is an
     * AsyncIterable representing recently-watched media from that app. Each result
     * can be passed directly to `play`.
     */
    public getRecentsMap(options?: QueryOptions) {
        return this.buildQueryMap(options, (app) =>
            app.channel.queryRecent?.bind(app.channel),
        );
    }

    /**
     * Get an AsyncIterable representing playables from across all
     * configured apps. Each result can be passed directly to `play`.
     */
    public queryRecents(options?: QueryOptions) {
        const m = this.getRecentsMap(options);
        return interleaveAsyncIterables(Object.values(m));
    }

    private buildQueryMap(
        options: QueryOptions | undefined,
        getQueryFn: (
            app: IConfiguredApp<IPlayerEnabledConstructor<any, any>>,
        ) => (() => AsyncIterable<IQueryResult>) | undefined,
    ) {
        const { onError } = unpackQueryOptions(options);
        return this.apps.reduce((m, app) => {
            const query = getQueryFn(app);
            if (query == null) return m;

            m[app.appConstructor.name] = {
                [Symbol.asyncIterator]: async function* () {
                    try {
                        const results = query?.();
                        if (results != null) {
                            yield* results;
                        }
                    } catch (e: any) {
                        onError(app.appConstructor.name, e);
                    }
                },
            };

            return m;
        }, {} as { [app: string]: AsyncIterable<IQueryResult> });
    }

    private async playOnEachDevice(
        configured: IConfiguredApp<any>,
        playable: IPlayable<any>,
        label: string,
        opts: IPlayableOptions,
    ) {
        return this.withEachDevice(async (d) => {
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
        return Promise.all(
            this.devices.map(async (d) => {
                try {
                    await block(d);
                } finally {
                    if (this.opts.autoClose !== false) {
                        debug("auto-close", d.friendlyName);
                        d.close();
                    }
                }
            }),
        );
    }
}

export type QueryOnlyPlayer = Omit<Player, "play" | "playUrl">;

export class PlayerBuilder {
    public static async autoInflate(configPath?: string) {
        const builder = new PlayerBuilder();

        for await (const [app, opts] of importConfig(configPath)) {
            builder.withApp(app, opts);
        }

        return builder;
    }

    constructor(
        private readonly apps: Array<IConfiguredApp<any>> = [],
        private readonly devices: ChromecastDevice[] = [],
        private opts: IPlayerOpts = {},
    ) {}

    public withApp<TConstructor extends IPlayerEnabledConstructor<Opts, IApp>>(
        appConstructor: TConstructor,
        ...options: OptionsFor<TConstructor>
    ) {
        const index = this.apps.findIndex(
            (old) => old.appConstructor === appConstructor,
        );
        if (index !== -1) {
            // extend existing config, for use with autoInflate();
            this.apps[index].options = this.apps[index].options.map(
                (old, i) => ({ ...old, ...options[i] }),
            );
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

    /**
     * Create a new PlayerBuilder instance with the same initial config as this PlayerBuilder
     */
    public clone() {
        return new PlayerBuilder([...this.apps], [...this.devices], {
            ...this.opts,
        });
    }

    /**
     * Build a Player instance that does not support playback methods
     */
    public buildQueryOnly(): QueryOnlyPlayer {
        return this.buildInternal();
    }

    public build() {
        if (!this.devices.length) {
            throw new Error("You must have at least one device");
        }

        return this.buildInternal();
    }

    private buildInternal() {
        if (!this.apps.length) {
            throw new Error("You must have at least one app enabled");
        }

        return new Player([...this.apps], [...this.devices], { ...this.opts });
    }
}
