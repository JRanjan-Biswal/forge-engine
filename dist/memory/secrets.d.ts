export declare class SecretError extends Error {
    name: string;
}
export declare function findSecrets(text: string): string[];
/** Throw before writing user-provided text that looks like it contains a secret. */
export declare function assertNoSecrets(text: string, where: string): void;
/** Replace secret-looking substrings, for machine-generated text such as command output. */
export declare function redactSecrets(text: string): string;
