import yargs from "yargs";

import { withConfig, withDevice } from "../../args";

import receiverStatus from "./receiver-status";

function useSharedArgs<T>(_args: yargs.Argv<T>): void {
    // NOTE: We have to provide a builder; this function
    // is a helper to avoid having to write args => args
    // all the time
}

export function createChromecastCommands(parser: yargs.Argv) {
    return parser.command(
        "cc <subcommand>",
        "Chromecast debug commands",
        (args: yargs.Argv) =>
            withDevice(withConfig(args))
                .command(
                    "receiver-status",
                    "Get the current receiver status",
                    useSharedArgs,
                    receiverStatus,
                )
                .demandCommand(1),
        () => {
            /* nop */
        },
    );
}
