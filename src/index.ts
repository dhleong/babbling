export { ChromecastDevice } from "./device";
export { PlayerBuilder } from "./player";
export { HboGoApp, IHboGoOpts, IHboGoPlayOptions } from "./apps/hbogo";
export { HuluApp, IHuluOpts } from "./apps/hulu";
export { PrimeApp, IPrimeOpts } from "./apps/prime";
export { YoutubeApp, IYoutubeOpts } from "./apps/youtube";

// for building apps that won't be merged into core:
export { BaseApp } from "./apps/base";
export { BabblerBaseApp } from "./apps/babbler/base";
export { ICastSession, IDevice, IMediaStatusMessage, IMediaStatus } from "nodecastor";
export { awaitMessageOfType } from "./apps/util";
export { IPlaybackTrackerEvents, PlaybackTracker } from "./apps/playback-tracker";
