import fs from "fs-extra";
import pathlib from "path";

export async function readConfig(path: string) {
    let raw: Buffer;
    try {
        raw = await fs.readFile(path);
    } catch (e) {
        return {};
    }
    return JSON.parse(raw.toString());
}

export async function writeConfig(path: string, obj: any) {
    await fs.mkdirp(pathlib.dirname(path));
    return fs.writeFile(path, JSON.stringify(obj, null, "  "));
}

export function setPath(obj: any, path: string[], newValue: string) {
    if (path.length === 0) throw new Error("Invalid path");

    let o = obj;
    for (let i = 0; i < path.length - 1; ++i) {
        o = obj[path[i]];
        if (o === undefined) {
            o = {};
            obj[path[i]] = o;
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

    // tslint:disable-next-line no-console
    console.log(`${key}: `, json[key]);
}

export async function configInPath(
    configFilePath: string,
    objPath: string[],
    value: any,
) {
    const json = await readConfig(configFilePath);
    setPath(json, objPath, value);
    await writeConfig(configFilePath, json);
}

export async function unconfig(configPath: string, key: string) {
    const json = await readConfig(configPath);
    delete json[key];
    await fs.writeFile(configPath, JSON.stringify(json, null, "  "));
}
