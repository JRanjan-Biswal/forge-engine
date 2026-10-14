import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import { LedgerEntry } from "../schemas/runtime.js";
import { assertNoSecrets } from "../memory/secrets.js";
import { withLock } from "./lock.js";
import { layout, nowIso } from "./paths.js";

export type LedgerInput = Omit<z.input<typeof LedgerEntry>, "id" | "at"> & { at?: string };

/** Read the append-only decision ledger. Malformed lines are skipped, never rewritten. */
export function readLedger(root: string): LedgerEntry[] {
  const file = layout(root).ledger;
  if (!existsSync(file)) return [];
  const entries: LedgerEntry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = LedgerEntry.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // A corrupt line must not take down the whole memory.
    }
  }
  return entries;
}

export function appendLedger(root: string, input: LedgerInput): LedgerEntry {
  const file = layout(root).ledger;
  // Locked: the next id is derived from the file, so concurrent writers would collide.
  return withLock(root, () => {
    const lastId = readLedger(root).reduce((max, entry) => Math.max(max, Number(entry.id.slice(2))), 0);
    const entry = LedgerEntry.parse({ ...input, id: `D-${lastId + 1}`, at: input.at ?? nowIso() });
    assertNoSecrets([entry.summary, entry.why ?? "", ...entry.rejected].join("\n"), "ledger entry");
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  });
}
