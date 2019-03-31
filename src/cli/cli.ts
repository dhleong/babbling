// tslint:disable no-console

import yargs from "yargs";

import cast from "./commands/cast";

let canConfigure = false;
try {
    // tslint:disable-next-line no-var-requires
    require("chromagnon");
    canConfigure = true;
} catch (e) {
    /* ignore */
}

const parser = yargs;

parser.command(
    "cast <url>", `Cast a video by URL`, args => {
        return args.positional("url", {
            describe: "The URL to play",
            type: "string",
        }).demand("url")
            .option("device", {
                alias: "d",
                desc: "The name of the Chromecast device",
                required: true,
                type: "string",
            });
    }, cast,
);

if (canConfigure) {
    parser.command(
        "autoconfig", `Automatically configure available apps`, {
            // no command-specific config
        }, async argv => {
            // chromagnon is a huge dependency, and installs don't need
            // to require it since it's just for config, so we lazily
            // import the dependency in case it's not available
            const { default: configure } = require("./commands/config");
            console.log(configure);
            await configure();
        },
    );
}

parser.help()
    .demandCommand(1);

export async function main(args: any[]) {
    parser.parse(args.slice(2));
}
