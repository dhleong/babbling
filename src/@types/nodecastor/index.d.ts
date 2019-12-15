/// <reference types="node" />

declare module "nodecastor" {

    import { EventEmitter } from "events";

    export type Callback<T> = (e: Error | null, result: T) => any;

    export interface IBrowsable {
        stop(): void;
    }

    export interface ICastApp {
        id: string;
        join(ns: string, callback: Callback<ICastSession>): void;
        run(ns: string, callback: Callback<ICastSession>): void;
    }

    export interface ICastSession extends EventEmitter {
        id: string;
        send(message: any): void;
    }

    export interface ICastChannel {
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

    export interface IDevice {
        friendlyName: string;
        model: string;
        id: string;

        channel: ICastChannel;

        application(id: string, callback: Callback<ICastApp>): void;
        status(callback: Callback<IReceiverStatusMessage>): void;
        stop(): void;
        on(event: "connect", handler: () => any): IDevice;
        on(event: "status", handler: (status: IReceiverStatusMessage) => any): IDevice;
        removeListener(event: string, handler: (... args: any[]) => any): IDevice;
    }

    export class CastDevice {
        constructor(info: any);
    }

    export interface IScanner {
        browser: IBrowsable;

        end(): void;
        start(): void;

        on(event: "online", handler: (device: IDevice) => any): IScanner;
    }

    export interface IMedia {
        contentId: string;
        contentType: string;
        customData: any;

        streamType: "BUFFERED";
    }

    export interface IQueueEntry {
        customData: any;
        media: IMedia;
    }

    export interface ILoadRequest {
        autoplay?: boolean;
        currentTime?: number;
        customData?: any;
        media: IMedia;
        queueData?: {
            items: IQueueEntry[];
            startIndex: number;
        };
        sessionId: string;
        type: "LOAD";
    }

    export function scan(options: any): IScanner;
}
