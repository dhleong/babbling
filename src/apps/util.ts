import _debug from "debug";
const debug = _debug("babbling:util");

import { IMessage, StratoChannel } from "stratocaster";

export const awaitMessageOfType = (
    session: StratoChannel, type: string,
    timeoutMs: number = 5000,
): Promise<any> => awaitMessageOfTypeFrom(
    session.receive(), type, timeoutMs,
);

export const awaitMessageOfTypeFrom = (
    stream: AsyncIterable<IMessage>, type: string,
    timeoutMs: number = 5000,
): Promise<any> => Promise.race([
    new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Timeout waiting for ${type}`));
        }, timeoutMs);
    }),

    (async () => {
        for await (const m of stream) {
            const received = (m.data as any).type;
            const found = received === type;
            debug("saw", received, "waiting for", type, found);
            if (found) {
                debug("yield: ", m.data);
                return m.data;
            }
        }

        throw new Error(`Failed to receive ${type}`);
    })(),
]);
