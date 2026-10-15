import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "../core/lock.js";
import { layout, nowIso, writeTextAtomic } from "../core/paths.js";
import { assertNoSecrets } from "./secrets.js";
function section(title, items) {
    if (!items?.length)
        return "";
    return "## ".concat(title, "\n\n", items.map((item) => "- ".concat(item)).join("\n"), "\n\n");
}
/** Save a session summary as .forge/episodes/YYYY-MM-DD-n.md. */
export function saveEpisode(root, input) {
    // Locked: the file number is derived from what is on disk.
    return withLock(root, () => saveEpisodeUnlocked(root, input));
}
function saveEpisodeUnlocked(root, input) {
    if (!input.goal.trim())
        throw new Error("An episode needs a goal");
    const dir = layout(root).episodes;
    mkdirSync(dir, { recursive: true });
    const at = nowIso();
    const day = at.slice(0, 10);
    let n = readdirSync(dir).filter((name) => name.startsWith(day)).length + 1;
    while (existsSync(join(dir, "".concat(day, "-", n, ".md"))))
        n++;
    const file = "".concat(day, "-", n, ".md");
    const frontmatter = ["---", "at: ".concat(at), ...(input.stage ? ["stage: ".concat(input.stage)] : []), "---"].join("\n");
    const text = "".concat(frontmatter, "\n\n# ", input.goal.trim(), "\n\n") +
        section("Done", input.done) +
        section("Decisions", input.decisions) +
        section("Open threads", input.openThreads) +
        (input.next ? "## Next\n\n".concat(input.next.trim(), "\n") : "");
    assertNoSecrets(text, "episode");
    writeTextAtomic(join(dir, file), text);
    return { file: ".forge/episodes/".concat(file), at, stage: input.stage, text };
}
function parseFrontmatter(text) {
    const match = /^---\n([\s\S]*?)\n---/.exec(text);
    const fields = {};
    for (const line of match?.[1]?.split("\n") ?? []) {
        const index = line.indexOf(":");
        if (index > 0)
            fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return fields;
}
/** Episodes, newest first. */
export function listEpisodes(root) {
    const dir = layout(root).episodes;
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => {
        const text = readFileSync(join(dir, name), "utf8");
        const fields = parseFrontmatter(text);
        return { file: ".forge/episodes/".concat(name), at: fields.at ?? "", stage: fields.stage, text };
    })
        // Same-millisecond episodes tie on `at`; the file's sequence number breaks the tie.
        .sort((a, b) => b.at.localeCompare(a.at) || b.file.localeCompare(a.file, undefined, { numeric: true }));
}
