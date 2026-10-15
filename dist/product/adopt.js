import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Forge } from "../core/engine.js";
import { layout } from "../core/paths.js";
import { detectStacks, useStacks } from "../build/stacks.js";
import { syncProduct } from "./sync.js";
/**
 * Bring forge into a product that already exists (brownfield): initialise, enable the
 * `adopt` pack (adds the `understand` stage), skip greenfield-only stages with a
 * recorded reason, record the stacks it can recognise (filling only empty gate
 * commands), and build the first product map + code graph.
 */
const GREENFIELD_ONLY = ["brainstorm", "validate"];
function enableAdoptPack(root) {
    const file = layout(root).config;
    const text = readFileSync(file, "utf8");
    const match = /^packs:\s*\[(.*?)\]/m.exec(text);
    if (match) {
        const packs = (match[1] ?? "").split(",").map((p) => p.trim()).filter(Boolean);
        if (packs.includes("adopt"))
            return;
        writeFileSync(file, text.replace(match[0], "packs: [".concat([...packs, "adopt"].join(", "), "]")));
    }
    else {
        writeFileSync(file, "".concat(text.trimEnd(), "\npacks: [adopt]\n"));
    }
}
export async function adoptProject(rootInput, options = {}) {
    const root = resolve(rootInput);
    const initialized = !existsSync(layout(root).state);
    if (initialized)
        Forge.init(root, { name: options.name });
    enableAdoptPack(root);
    const forge = new Forge(root);
    const state = forge.readState();
    const skipped = [];
    for (const id of GREENFIELD_ONLY) {
        const status = state.stages[id]?.status;
        if (status === "pending" || status === "active" || status === "failed") {
            forge.skip(id, "adopted an existing product (forge adopt): greenfield-only stage", "forge adopt");
            skipped.push(id);
        }
    }
    const stacks = detectStacks(root).length ? useStacks(root) : undefined;
    const sync = await syncProduct(root, { graph: options.graph });
    return { root, initialized, skipped, ...(stacks ? { stacks } : {}), sync };
}
