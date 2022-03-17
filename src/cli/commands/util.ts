// tslint:disable no-console

import readline from "readline";

export async function confirm(message?: string): Promise<void> {
    return new Promise<void>(resolve => {
        if (message) console.log(`${message}\n`);
        console.log("Press any key to continue.");

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once("data", () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve();
        });
    });
}

export async function prompt(promptText: string): Promise<string> {
    return new Promise(resolve => {
        const prompter = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        prompter.question(promptText, result => {
            prompter.close();
            resolve(result);
        });
    });
}

export function consoleWrite(str: string) {
    console.log(str.trim());
}
