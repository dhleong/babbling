import type {
    IApp, IAppConstructor,
} from "../app";

export async function* getAppConstructors(): AsyncIterable<IAppConstructor<any, IApp>> {
    const allExports = require("../index"); // eslint-disable-line
    for (const name of Object.keys(allExports)) {
        if (
            name.endsWith("App")
            && !name.endsWith("BaseApp")
            && allExports[name] instanceof Function
        ) {
            yield allExports[name];
        }
    }
}
