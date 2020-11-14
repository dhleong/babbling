import { discover } from "stratocaster";

export interface IScanOpts {
    timeout: number;
}

export default async function scanForDevices(opts: IScanOpts) {
    // tslint:disable no-console
    const timeout = opts.timeout;
    console.log("Scanning...");

    for await (const device of discover({ timeout })) {
        console.log(" -", device.name);
    }
}
