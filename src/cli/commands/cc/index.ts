import yargs from "yargs";

export function createChromecastCommands(parser: yargs.Argv) {
    return parser.command(
        "cc <subcommand>",
        "Chromecast debug commands",
        // (args: yargs.Argv) => args,
        (args: yargs.Argv) => args.command("check", "Get the current chromecast state", {}, () => {
            console.log("DO check");
        }).demandCommand(1),
        () => {
            console.log("HANDLE cc");
        },
    );
}
