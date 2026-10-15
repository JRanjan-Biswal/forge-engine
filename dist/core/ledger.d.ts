import type { z } from "zod";
import { LedgerEntry } from "../schemas/runtime.js";
export type LedgerInput = Omit<z.input<typeof LedgerEntry>, "id" | "at"> & {
    at?: string;
};
/** Read the append-only decision ledger. Malformed lines are skipped, never rewritten. */
export declare function readLedger(root: string): LedgerEntry[];
export declare function appendLedger(root: string, input: LedgerInput): LedgerEntry;
