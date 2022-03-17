import debug_ from "debug";

import childProc from "child_process";
import fs from "fs";
import { getAppConstructors } from "../../cli/config";
import { ChromecastDevice } from "../../device";
import { BabblerBaseApp } from "./base";

const debug = debug_("babbling:daemon");

const DAEMON_ENV = "IS_BABBLER_DAEMON";

export type RPCMethod = "loadMedia";
export type RPC = [ RPCMethod, any[] ]; // TODO type safety on args?

export interface IDaemonOptions {
    deviceName: string;
    appName: string;
    appOptions: any;

    /**
     * If provided, the first item in the array is the
     * method to call, and the second is an array of
     * parameters to be applied to it
     */
    rpc?: RPC;
}

export class BabblerDaemon {
    public static spawn(opts: IDaemonOptions) {
        const out = fs.openSync("daemon.log", "a");

        debug("spawn daemon with", process.env.DEBUG);
        const proc = childProc.fork("daemon", [], {
            cwd: __dirname,
            detached: true,
            env: {
                DEBUG: process.env.DEBUG,
                [DAEMON_ENV]: "true",
            },
            stdio: ["ignore", out, out, "ipc"],
        });
        proc.unref();

        return new Promise<void>((resolve, reject) => {
            proc.send(opts);
            proc.on("message", _ => {
                debug("child has started!");
                proc.disconnect();
                resolve();
            });
            proc.on("error", e => reject(e));
            debug("waiting for child");
        });
    }

    constructor(private opts: IDaemonOptions) {}

    public async run() {
        const appCtor = await this.findAppCtor();
        debug("found", appCtor.name);

        const device = new ChromecastDevice(this.opts.deviceName);
        const app = await device.openApp(
            appCtor,
            this.opts.appOptions,
        ) as BabblerBaseApp;

        await app.runDaemon();
        debug("daemon init completed");

        if (this.opts.rpc) {
            debug("performing rpc", this.opts.rpc);
            await app.rpc(this.opts.rpc);
        }
    }

    private async findAppCtor() {
        for await (const ctor of getAppConstructors()) {
            if (ctor.name === this.opts.appName) {
                return ctor;
            }
        }

        throw new Error(`Unknown app ${this.opts.appName}`);
    }
}

function runDaemon() {
    // quick reject
    if (!process.send) throw new Error();
    debug("daemon started; waiting for opts...");

    process.on("message", message => {
        // satisfy the compiler that it still exists:
        if (!process.send) throw new Error();
        process.send("running");

        // the parent proc will send a *single* message with our opts
        const opts = message as IDaemonOptions;
        debug("daemon received opts");

        const daemon = new BabblerDaemon(opts);
        daemon.run();
    });
}

if (process.env[DAEMON_ENV]) {
    runDaemon();
}
