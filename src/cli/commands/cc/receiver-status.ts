import { ChromecastDevice } from "stratocaster";
import { printJson } from "../util";

interface IDeviceOpts {
    device: string;
}

export default async function receiverStatus(opts: IDeviceOpts) {
    const device = new ChromecastDevice(opts.device);
    const status = await device.getStatus();
    device.close();
    printJson(status);
}
