import { Callback, ICastSession, IDevice } from "../cast";

export const awaitMessageOfType = (
    session: ICastSession, type: string,
    timeoutMs: number = 5000,
): Promise<any> => new Promise((resolve, reject) => {
    let onMessage: (m: any) => any;

    const timeoutId = setTimeout(() => {
        session.removeListener("message", onMessage);
        reject(new Error("Timeout waiting for " + type));
    }, timeoutMs);

    onMessage = message => {
        if (message.type === type) {
            clearTimeout(timeoutId);
            session.removeListener("message", onMessage);
            resolve(message);
        }
    };

    session.on("message", onMessage);
});

type Method0<TSelf, T> = (this: TSelf, callback: Callback<T>) => void;
type Method1<TSelf, T, TArg> = (this: TSelf, arg: TArg, callback: Callback<T>) => void;
type Method<TSelf, T> = Method0<TSelf, T> | Method1<TSelf, T, any>;

type ArgsOf<TM> = TM extends Method0<infer _, infer T> ? void[] :
    TM extends Method1<infer __, infer T2, infer TArg> ? [TArg] :
    never;

type ResultOf<TM> = TM extends Method0<infer _, infer T> ? T :
    TM extends Method1<infer __, infer T2, infer TArg> ? T2 :
    never;

export function promise<TSelf, TM extends Method<TSelf, any>>(
    device: TSelf,
    method: TM,
    ... args: ArgsOf<TM>
): Promise<ResultOf<TM>> {
    return new Promise<ResultOf<TM>>((resolve, reject) => {
        const call = [...args, (err: Error | null, result: ResultOf<TM>) => {
            if (err) reject(err);
            else resolve(result);
        }];
        (method as any).apply(device, call);
    });
}

export function getApp(device: IDevice, appId: string) {
    return promise(device, device.application, appId);
}
