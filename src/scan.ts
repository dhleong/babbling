import _debug from "debug";
const debug = _debug("babbling:scan");

import { EventEmitter } from "events";
import mdns from "mdns";
import { CastDevice, IDevice } from "nodecastor";

export enum ScanAction {
    StopScanning,
    CloseDevice,
    Connect,
    ConnectAndStopScanning,
}

/**
 * This class based on nodecastor.scan; we've inlined to workaround
 * a bug in the original, as well as to add extra info to the CastDevice
 */
class DeviceEmitter extends EventEmitter {
    private browser: mdns.Browser;
    private knownDevices: {[id: string]: CastDevice} = {};

    private logger: any | undefined;
    private timeout: number;

    constructor(options: {
        logger?: any,
        timeout?: number,
    } = {}) {
        super();

        this.logger = options.logger;
        this.timeout = options.timeout || 5000;

        const family = 0; // UNSPEC, can also use 4 or 6.
        const resolverSequence = [
            mdns.rst.DNSServiceResolve(),
            "DNSServiceGetAddrInfo" in mdns.dns_sd
                ? mdns.rst.DNSServiceGetAddrInfo()
                : mdns.rst.getaddrinfo({ families: [ family ] }),
            mdns.rst.makeAddressesUnique(),
        ];
        this.browser = mdns.createBrowser(mdns.tcp("googlecast"), {
            resolverSequence,
        });
        this.browser.on("serviceUp", d => this.onServiceUp(d));
        this.browser.on("serviceDown", d => this.onServiceDown(d));
    }

    public start() {
        this.browser.start();
    }

    public stop() {
        this.browser.stop();
    }

    private onServiceUp(d: mdns.Service): void {
        if (this.knownDevices[d.txtRecord.id]) return;

        const c = new CastDevice({
            address: d.addresses[0],
            friendlyName: d.txtRecord.fn,
            id: d.txtRecord.id,
            port: d.port,

            logger: this.logger,
            reconnect: {},
            timeout: this.timeout,
        }) as IDevice;

        c.model = d.txtRecord.md;

        this.knownDevices[c.id] = c;
        this.emit("online", c);
    }
    private onServiceDown(d: mdns.Service): void {
        if (!this.knownDevices[d.txtRecord.id]) return;
        throw new Error("Method not implemented.");
    }
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

    const scanner = new DeviceEmitter(options);

    const stopScanner = () => {
        debug("stop scanning");
        scanner.stop();
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
