import _debug from "debug";
const debug = _debug("babbling:scan");

import nodecastor from "nodecastor";

import { IDevice } from "./cast";

export enum ScanAction {
    StopScanning,
    CloseDevice,
    Connect,
    ConnectAndStopScanning,
}

export function scan(scanOpts: {
    timeout: number,
    onDevice: (device: IDevice) => ScanAction,
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
            device.stop();
            return;

        case ScanAction.StopScanning:
            // stop early
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
            scanOpts.onDevice(device);
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

                resolve(device);
                return ScanAction.ConnectAndStopScanning;
            },
            onTimeout: () => {
                reject(new Error("Could not find device"));
            },
        });
    });
}
