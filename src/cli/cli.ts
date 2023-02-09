/* eslint-disable no-console */

import yargs from "yargs";

import { withConfig, withDevice, withKey, withValue } from "./args";
import cast from "./commands/cast";
import { config, unconfig } from "./commands/config";
import mediaControlCommand from "./commands/do";
import findByTitle from "./commands/find";
import getRecommendations from "./commands/recommend";
import scanForDevices from "./commands/scan";
import searchByTitle from "./commands/search";

import { login as plexLogin } from "./commands/auth/plex";
import { login as primeLogin } from "./commands/auth/prime";
import { login as youtubeLogin } from "./commands/auth/youtube";

// type-safe conditional import via reference elision
import * as AuthCommand from "./commands/auth";
import { createChromecastCommands } from "./commands/cc";

let authCommandModule: typeof AuthCommand;

let canAutoConfigure = false;
try {
    /* eslint-disable global-require */
    require("chromagnon"); // eslint-disable-line import/no-extraneous-dependencies
    canAutoConfigure = true;

    authCommandModule = require("./commands/auth");
    /* eslint-enable global-require */
} catch (e) {
    /* ignore */
}

const parser = yargs;

parser.command(
    "cast <url>",
    "Cast a video by URL",
    (args: yargs.Argv) =>
        withDevice(withConfig(args))
            .positional("url", {
                describe: "The URL to play",
                type: "string",
            })
            .demandOption("url"),
    cast,
);

parser.command(
    "do <cmd> [arg]",
    "Send a media control command",
    (args: yargs.Argv) =>
        withDevice(withConfig(args))
            .positional("cmd", {
                choices: [
                    "next",
                    "prev",

                    "pause",
                    "play",
                    "play-again",
                    "skip-ad",
                    "stop",

                    "ff",
                    "rew",

                    "mute",
                    "unmute",
                    "volume",
                ],
                describe: "The command to send",
                type: "string",
            })
            .positional("arg", {
                describe: "The numeric argument to the command (if any)",
                type: "number",
            })
            .demandOption("cmd"),
    mediaControlCommand,
);

parser.command(
    "find <title>",
    "Find and Cast by title",
    (args: yargs.Argv) =>
        withDevice(withConfig(args))
            .positional("title", {
                describe: "The title to play",
                type: "string",
            })
            .demandOption("title")
            .option("dry-run", {
                describe:
                    "If set, will just print out the title that *would* play",
                type: "boolean",
            })
            .option("season", {
                describe:
                    "The season number to play. If `episode` is not provided, plays the first episode of that season.",
                type: "number",
            })
            .option("episode", {
                describe:
                    "The episode number to play. Must not be provided without `season`.",
                type: "number",
            }),
    findByTitle,
);

parser.command(
    "scan",
    "Scan for available devices",
    (args: yargs.Argv) =>
        withConfig(args).option("timeout", {
            alias: "t",
            default: 15000,
            type: "number",
        }),
    scanForDevices,
);

parser.command(
    "search <title>",
    "List matching titles",
    (args: yargs.Argv) =>
        withConfig(args)
            .positional("title", {
                describe: "The title to search for",
                type: "string",
            })
            .demandOption("title"),
    searchByTitle,
);

parser.command(
    "recommend",
    "List recommendations",
    (args: yargs.Argv) => withConfig(args),
    getRecommendations,
);

parser.command(
    "config <key> [value]",
    "Configure (or view) default options",
    (args) => withConfig(withValue(withKey(args))),
    async (argv) => {
        await config(argv.config, argv.key, argv.value);
    },
);
parser.command(
    "unconfig <key>",
    "Remove a configured key",
    (args) => withConfig(withKey(args)),
    async (argv) => {
        await unconfig(argv.config, argv.key);
    },
);

if (canAutoConfigure) {
    parser.command(
        "auto-auth",
        "Automatically authenticate available apps",
        (args) =>
            withConfig(args).option("ignore-errors", {
                default: false,
                describe: "Don't modify app auths that fail",
                type: "boolean",
            }),
        async (argv) => {
            // chromagnon is a huge dependency, and installs don't need
            // to require it since it's just for config, so we lazily
            // import the dependency in case it's not available
            await authCommandModule.authenticate(argv);
        },
    );
}

parser.command(
    "auth:plex",
    "Auth with Plex",
    (args) => withConfig(args),
    async (argv) => {
        await plexLogin(argv);
    },
);

parser.command(
    "auth:prime <email>",
    "Auth with prime",
    (args) =>
        withConfig(args)
            .positional("email", {
                describe: "Email address",
                type: "string",
            })
            .demandOption("email"),
    async (argv) => {
        await primeLogin(argv, argv.email);
    },
);

parser.command(
    "auth:youtube",
    "Auth with youtube",
    withConfig,
    async (argv) => {
        await youtubeLogin(argv);
    },
);

createChromecastCommands(parser).help().recommendCommands().demandCommand(1);

export async function main(args: any[]) {
    const result = await parser.parse(args.slice(2));
    if (result.config || result._[0] === "cc") {
        // We loaded config, which means yargs handled it,
        // or it was a cc command, in which case... yargs
        // handled it. Why doesn't yargs handle missing top-level
        // commands...? No idea!
        return;
    }

    parser.showHelp();
    console.log();
    console.log("Unknown command", result._[0]);
}
