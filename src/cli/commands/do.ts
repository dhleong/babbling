import { ChromecastDevice } from "../../device";

export interface IMediaControlCommand {
    cmd: string;
    device: string;
    arg?: number;
}

function requireArg(opts: IMediaControlCommand) {
    if (opts.arg === undefined) {
        throw new Error("You must provide [arg]");
    }
    return opts.arg;
}

export default async function mediaControlCommand(
    opts: IMediaControlCommand,
) {
    const device = new ChromecastDevice(opts.device);

    try {
        const controls = await device.openControls();

        switch (opts.cmd) {
        case "pause": controls.pause(); break;
        case "play": controls.play(); break;
        case "play-again": controls.playAgain(); break;
        case "skip-ad": controls.skipAd(); break;
        case "stop": controls.stop(); break;

        case "next": controls.nextQueueItem(); break;
        case "prev": controls.prevQueueItem(); break;

        case "ff": controls.seekRelative(requireArg(opts)); break;
        case "rew": controls.seekRelative(requireArg(opts)); break;
        case "seek": controls.seekTo(requireArg(opts)); break;

        case "mute": controls.setMuted(true); break;
        case "unmute": controls.setMuted(false); break;

        case "volume": controls.setVolume(requireArg(opts) / 10); break;

        default:
            throw new Error(`Unknown command '${opts.cmd}'`);
        }

    } finally {
        device.close();
    }
}
