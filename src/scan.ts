import _debug from "debug";
const debug = _debug("babbling:scan");

import nodecastor, { IDevice } from "nodecastor";

export enum ScanAction {
    StopScanning,
    CloseDevice,
    Connect,
    ConnectAndStopScanning,
}

export function scan(scanOpts: {
    timeout: number,
    onDevice: (device: IDevice) => ScanAction,

    onConnect: (device: IDevice) => void,
    onTimeout: () => void,
}) {
    let options;
    if (_debug.enabled("chromecast")) {
        options = {
            logger: console,
        };
    }

    const scanner = nodecastor.scan(options);

    const stopScanner = () => {
        debug("stop scanning");

        // HACKS:
        try {
            scanner.end();
        } catch (e) {
            scanner.browser.stop();
        }
    };

    const timeoutId = setTimeout(() => {
        stopScanner();
        scanOpts.onTimeout();
    }, scanOpts.timeout);

    scanner.on("online", device => {
        const action = scanOpts.onDevice(device);
        switch (action) {
        case ScanAction.CloseDevice:
            // not interested in this device
            debug("not interested in ", device.friendlyName);
            device.stop();
            return;

        case ScanAction.StopScanning:
            // stop early
            debug("StopScanning");
            clearTimeout(timeoutId);
            stopScanner();
            return;
        }

        if (action === ScanAction.ConnectAndStopScanning) {
            // stopping; cancel timeout
            clearTimeout(timeoutId);

            stopScanner();
        }

        debug("connecting to ", device.friendlyName);
        device.on("connect", () => {
            debug("connected to ", device.friendlyName);
            scanOpts.onConnect(device);
        });
    });

    scanner.start();
}

export function findFirst(
    predicate: (device: IDevice) => boolean,
    timeout: number,
): Promise<IDevice> {
    return new Promise((resolve, reject) => {
        scan({
            timeout,

            onDevice: device => {
                if (!predicate(device)) {
                    return ScanAction.CloseDevice;
                }

                return ScanAction.ConnectAndStopScanning;
            },

            onConnect: device => resolve(device),
            onTimeout: () => {
                reject(new Error("Could not find device"));
            },
        });
    });
}
