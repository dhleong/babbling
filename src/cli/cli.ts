// tslint:disable no-console

import yargs from "yargs";

import { withConfig, withDevice, withKey, withValue } from "./args";
import cast from "./commands/cast";
import { config, unconfig } from "./commands/config";
import mediaControlCommand from "./commands/do";
import findByTitle from "./commands/find";
import scanForDevices from "./commands/scan";
import searchByTitle from "./commands/search";

import authorizePrime from "./commands/auth/prime";

// type-safe conditional import via reference elision
import * as AuthCommand from "./commands/auth";
import { IAuthOpts } from "./commands/auth";
let authCommandModule: typeof AuthCommand;

let canAutoConfigure = false;
try {
    // tslint:disable no-var-requires
    require("chromagnon");
    canAutoConfigure = true;

    authCommandModule = require("./commands/auth");
    // tslint:enable no-var-requires
} catch (e) {
    /* ignore */
}

const parser = yargs;

parser.command(
    "cast <url>", `Cast a video by URL`, args => {
        return withDevice(withConfig(args)).positional("url", {
            describe: "The URL to play",
            type: "string",
        }).demand("url");
    }, cast,
);

parser.command(
    "do <cmd> [arg]", `Send a media control command`, args => {
        return withDevice(withConfig(args)).positional("cmd", {
            choices: [
                "next", "prev",

                "pause", "play", "play-again",
                "skip-ad",
                "stop",

                "ff", "rew",

                "mute", "unmute", "volume",
            ],
            describe: "The command to send",
            type: "string",
        })
        .positional("arg", {
            describe: "The numeric argument to the command (if any)",
            type: "number",
        })
        .demand("cmd");
    }, mediaControlCommand,
);

parser.command(
    "find <title>", `Find and Cast by title`, args => {
        return withDevice(withConfig(args)).positional("title", {
            describe: "The title to play",
            type: "string",
        }).demand("title");
    }, findByTitle,
);

parser.command(
    "scan", `Scan for available devices`, args => {
        return withConfig(args).option("timeout", {
            alias: "t",
            default: 15000,
            type: "number",
        });
    }, scanForDevices,
);

parser.command(
    "search <title>", `List matching titles`, args => {
        return withConfig(args).positional("title", {
            describe: "The title to search for",
            type: "string",
        }).demand("title");
    }, searchByTitle,
);

parser.command(
    "config <key> [value]", `Configure (or view) default options`, args => {
        return withConfig(withValue(withKey(args)));
    }, async argv => {
        await config(argv.config, argv.key, argv.value);
    },
);
parser.command(
    "unconfig <key>", `Remove a configured key`, args => {
        return withConfig(withKey(args));
    }, async argv => {
        await unconfig(argv.config, argv.key);
    },
);

if (canAutoConfigure) {
    parser.command(
        "auto-auth", `Automatically authenticate available apps`, args => {
            return withConfig(args).option("ignore-errors", {
                default: false,
                describe: `Don't modify app auths that fail`,
                type: "boolean",
            });
        }, async argv => {
            // chromagnon is a huge dependency, and installs don't need
            // to require it since it's just for config, so we lazily
            // import the dependency in case it's not available
            // NOTE: yargs converts the ignore-errors flag to
            // camelCase, but typescript doesn't know that
            const opts = argv as unknown as IAuthOpts;
            await authCommandModule.authenticate(opts);
        },
    );
}

parser.command(
    "auth:prime <code>", `Auth with prime`, args => {
        return withConfig(args).positional("code", {
            describe: `Auth code`,
            type: "string",
        }).demand("code");
    }, async argv => {
        await authorizePrime(argv.code);
    },
);

parser.help()
    .demandCommand(1);

export async function main(args: any[]) {
    const result = parser.parse(args.slice(2));
    if (result.config) {
        // we loaded config, which means yargs handled it
        return;
    }

    parser.showHelp();
    console.log("Unknown command", result._[0]);
}
