// tslint:disable no-console

import yargs from "yargs";

import { withConfig, withKey, withValue } from "./args";
import cast from "./commands/cast";
import { config, unconfig } from "./commands/config";

let canAutoConfigure = false;
try {
    // tslint:disable-next-line no-var-requires
    require("chromagnon");
    canAutoConfigure = true;
} catch (e) {
    /* ignore */
}

const parser = yargs;

parser.command(
    "cast <url>", `Cast a video by URL`, args => {
        return withConfig(args).positional("url", {
            describe: "The URL to play",
            type: "string",
        }).demand("url")
            .option("device", {
                alias: "d",
                demandOption: true,
                desc: "The name of the Chromecast device to cast to",
                type: "string",
            });
    }, cast,
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
        "auto-auth", `Automatically authenticate available apps`, {
            // no command-specific config
        }, async argv => {
            // chromagnon is a huge dependency, and installs don't need
            // to require it since it's just for config, so we lazily
            // import the dependency in case it's not available
            const { default: authenticate } = require("./commands/auth");
            await authenticate();
        },
    );
}

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
