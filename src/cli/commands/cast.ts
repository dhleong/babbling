import { ChromecastDevice } from "../../device";
import { PlayerBuilder } from "../../player";

export default async function cast(opts: {device: string, url: string}) {
    const builder = await PlayerBuilder.autoInflate();
    builder.addDevice(new ChromecastDevice(opts.device));
    const player = builder.build();
    await player.playUrl(opts.url);
}
