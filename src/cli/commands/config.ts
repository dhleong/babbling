import _debug from "debug";

import fs from "fs-extra";
import pathlib from "path";
import { Deferred } from "../../async";

const debug = _debug("babbling:config");

export async function readConfig(path: string) {
    let raw: Buffer;
    try {
        raw = await fs.readFile(path);
    } catch (e) {
        return {};
    }
    return JSON.parse(raw.toString());
}

const configLocks: { [path: string]: Promise<void> } = {};

export async function writeConfig(path: string, obj: any) {
    debug("start writing config...");
    await fs.mkdirp(pathlib.dirname(path));
    await fs.writeFile(path, JSON.stringify(obj, null, "  "));
    debug("... done writing config.");
}

export function setPath(obj: any, path: string[], newValue: string) {
    if (path.length === 0) throw new Error("Invalid path");

    let o = obj;
    for (let i = 0; i < path.length - 1; ++i) {
        o = obj[path[i]];
        if (o === undefined) {
            o = {};
            obj[path[i]] = o; // eslint-disable-line no-param-reassign
        }
    }

    o[path[path.length - 1]] = newValue;

    return obj;
}

export async function config(configPath: string, key: string, value?: string) {
    const json = await readConfig(configPath);
    if (value) {
        json[key] = value;
        await writeConfig(configPath, json);
        return;
    }

    // eslint-disable-next-line no-console
    console.log(`${key}: `, json[key]);
}

async function updateConfigWithMethods(
    doReadConfig: (path: string) => Promise<any>,
    doWriteConfig: (path: string, json: any) => Promise<void>,
    configPath: string,
    update: (old: any) => any,
) {
    const myLock = new Deferred<void>();

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const lock = configLocks[configPath];
        if (lock == null) {
            debug("config unlocked; locking for ourselves:", configPath);
            configLocks[configPath] = myLock.promise;
            break;
        } else {
            debug("config locked: ", configPath, "; waiting...");
            await lock;
        }
    }

    try {
        const json = await doReadConfig(configPath);
        const newJson = update(json);
        await doWriteConfig(configPath, newJson);
    } finally {
        delete configLocks[configPath];
        myLock.resolve();
        debug("released lock:", configPath);
    }
}

/** for testing */
export function createConfigUpdater(
    doReadConfig: (path: string) => Promise<any>,
    doWriteConfig: (path: string, json: any) => Promise<void>,
) {
    return async (configPath: string, update: (old: any) => any) => {
        await updateConfigWithMethods(
            doReadConfig,
            doWriteConfig,
            configPath,
            update,
        );
    };
}

const updateConfig = createConfigUpdater(readConfig, writeConfig);

export async function configInPath(
    configFilePath: string,
    objPath: string[],
    value: any,
) {
    await updateConfig(configFilePath, (json) => {
        setPath(json, objPath, value);
        return json;
    });
}

export async function unconfig(configPath: string, key: string) {
    await updateConfig(configPath, (json) => {
        // eslint-disable-next-line no-param-reassign
        delete json[key];
        return json;
    });
}
