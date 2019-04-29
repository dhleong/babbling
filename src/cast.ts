import { EventEmitter } from "events";

/*
 * shadows of nodecastor types for portability
 * TODO: a better solution would be to wrap the nodecastor API
 *  and expose that; we could also publish our nodecastor typings,
 *  but they're very incomplete and I don't want to maintain the
 *  bits we don't use...
 */

export type Callback<T> = (e: Error | null, result: T) => any;
export interface ICastApp {
    id: string;
    join(ns: string, callback: Callback<ICastSession>): void;
    run(ns: string, callback: Callback<ICastSession>): void;
}

export interface IDevice {
    friendlyName: string;

    application(id: string, callback: Callback<ICastApp>): void;
    status(callback: Callback<IReceiverStatusMessage>): void;
    stop(): void;
    on(event: "connect", handler: () => any): IDevice;
    on(event: "status", handler: (status: IReceiverStatusMessage) => any): IDevice;
    removeListener(event: string, handler: (... args: any[]) => any): IDevice;
}

export interface ICastSession extends EventEmitter {
    id: string;
    send(message: any): void;
}

export interface IAppStatus {
    appId: string;
    displayName: string;
    iconUrl: string;
    isIdleScreen: boolean;
    launchedFromCloud: boolean;
    namespaces: Array<{name: string}>;
    sessionId: string;
    statusText: string;
    transportId: string;
}

export interface IReceiverStatusMessage {
    applications?: IAppStatus[];
    volume: {
        controlType: string,
        level: number,
        muted: boolean,
        stepInterval: number,
    };
}

export interface IMediaStatus {
    currentItemId: number;

    /** floating point number in seconds */
    currentTime: number;

    mediaSessionId: number;
    playbackRate: number;
    playerState: "BUFFERING" | "IDLE" | "LOADING" | "PAUSED" | "PLAYING";
}

export interface IMediaStatusMessage {
    status: IMediaStatus[];
}
