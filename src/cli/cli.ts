// tslint:disable no-console

export async function main(args: any[]) {
    let canConfigure = false;
    try {
        require("chromagnon");
        canConfigure = true;
    } catch (e) {
        /* ignore */
    }

    if (canConfigure) {
        const { default: configure } = require("./commands/config");
        console.log(configure);
        await configure();
    }
}
