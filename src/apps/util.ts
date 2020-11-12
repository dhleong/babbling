import { StratoChannel } from "stratocaster";

import { ICastSession } from "../cast";

export const awaitMessageOfType = (
    session: StratoChannel, type: string,
    timeoutMs: number = 5000,
): Promise<any> => Promise.race([
    new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Timeout waiting for ${type}`));
        });
    }),

    (async () => {
        for await (const m of session.receive()) {
            if ((m.data as any).type === type) {
                return m.data;
            }
        }

        throw new Error(`Failed to receive ${type}`);
    })(),
]);

export const awaitMessageOfTypeOld = (
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
