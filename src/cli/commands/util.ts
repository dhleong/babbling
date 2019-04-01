// tslint:disable no-console

import readline from "readline";

export async function prompt(promptText: string) {
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
