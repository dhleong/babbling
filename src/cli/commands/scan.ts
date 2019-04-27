import { scan, ScanAction } from "../../scan";

export interface IScanOpts {
    timeout: number;
}

export default function scanForDevices(opts: IScanOpts) {
    // tslint:disable no-console
    const timeout = opts.timeout;
    console.log("Scanning...");
    return new Promise(resolve => {
        scan({
            timeout,

            onDevice: device => {
                console.log(" -", device.friendlyName);
                return ScanAction.CloseDevice;
            },
            onTimeout: resolve,
        });
    });
}
