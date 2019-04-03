import { Argv } from "yargs";

import { DEFAULT_CONFIG_PATH } from "./config";

export function withConfig<T>(args: Argv<T>) {
    return args.option("config", {
        alias: "c",
        config: true,
        default: DEFAULT_CONFIG_PATH,
        describe: `Config file path`,
        type: "string",
    });
}

export function withDevice<T>(args: Argv<T>) {
    return args.option("device", {
        alias: "d",
        demandOption: true,
        desc: "The name of the Chromecast device to cast to",
        type: "string",
    });
}

export function withKey<T>(args: Argv<T>) {
    return args.positional("key", {
        choice: ["device"],
        describe: `Config key`,
        type: "string",
    }).demand("key");
}

export function withValue<T>(args: Argv<T>) {
    return args.positional("value", {
        describe: `Config key`,
        type: "string",
    });
}
