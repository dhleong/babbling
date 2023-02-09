import { ChromecastDevice } from "stratocaster";

export default async function withDevice<R = void>(
    name: string,
    block: (device: ChromecastDevice) => Promise<R>,
) {
    const device = new ChromecastDevice(name);
    try {
        return await block(device);
    } finally {
        device.close();
    }
}
