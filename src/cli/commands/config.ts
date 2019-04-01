import fs from "fs-extra";
import pathlib from "path";

export async function readConfig(path: string) {
    const raw = await fs.readFile(path);
    return JSON.parse(raw.toString());
}

export async function writeConfig(path: string, obj: any) {
    await fs.mkdirp(pathlib.dirname(path));
    return fs.writeFile(path, JSON.stringify(obj, null, "  "));
}

export async function config(configPath: string, key: string, value?: string) {
    const json = await readConfig(configPath);
    if (value) {
        json[key] = value;
        await fs.writeFile(configPath, JSON.stringify(json, null, "  "));
        return;
    }

    // tslint:disable-next-line no-console
    console.log(`${key}: `, json[key]);
}

export async function unconfig(configPath: string, key: string) {
    const json = await readConfig(configPath);
    delete json[key];
    await fs.writeFile(configPath, JSON.stringify(json, null, "  "));
}
