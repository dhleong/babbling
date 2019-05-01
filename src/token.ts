export interface IWritableToken {
    read(): string;
    write(newValue: string): Promise<void>;
}

export type Token = string | IWritableToken;

export function read(token: Token): string {
    if (typeof token === "string") return token;
    return token.read();
}

export async function write(token: Token, newValue: string): Promise<void> {
    if (typeof token === "string") return;
    return token.write(newValue);
}
