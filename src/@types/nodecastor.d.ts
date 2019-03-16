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

    export interface IDevice {
        friendlyName: string;

        application(id: string, callback: Callback<ICastApp>): void;
        stop(): void;
        on(event: "connect", handler: () => any): IDevice;
    }

    export interface IScanner {
        browser: IBrowsable;

        end(): void;
        start(): void;

        on(event: "online", handler: (device: IDevice) => any): IScanner;
    }

    export function scan(options: any): IScanner;
}
