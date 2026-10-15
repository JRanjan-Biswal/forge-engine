#!/usr/bin/env node
export interface CliIO {
    out: (line: string) => void;
    err: (line: string) => void;
    stdin?: () => Promise<string>;
}
export declare function run(argv: string[], io?: CliIO): Promise<number>;
