import { ChromecastDevice } from "../../device";
import { PlayerBuilder } from "../../player";

export interface ICastOpts {
    config: string;
    device: string;
    url: string;
}

export default async function cast(opts: ICastOpts) {
    const builder = await PlayerBuilder.autoInflate(opts.config);
    builder.addDevice(new ChromecastDevice(opts.device));
    const player = builder.build();
    await player.playUrl(opts.url);
}
