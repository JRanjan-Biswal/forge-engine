import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadArtifact } from "../core/artifacts.js";
import { listProjectFiles } from "../product/scan.js";
import { linkTrace } from "../trace/trace.js";
const TEST_FILE = /(^|\/)(__tests__|tests?|e2e|spec|\.maestro|maestro|playwright)\/|\.(test|spec|e2e)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.py$/i;
const TAG = /@?\b([A-Za-z][\w.-]*\/AC\d+)\b/g;
const slug = (id) => id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export function qaPlan(root) {
    const prd = loadArtifact(root, "prd");
    if (!prd)
        throw new Error("No PRD yet — the spec stage writes it (artifact_write prd)");
    let screens;
    try {
        screens = loadArtifact(root, "screens");
    }
    catch {
        screens = undefined;
    }
    return prd.stories
        .filter((story) => story.mvp && story.priority !== "wont")
        .flatMap((story) => {
        const platforms = new Set((screens?.screens ?? []).filter((s) => s.storyIds.includes(story.id)).map((s) => s.platform));
        const tool = platforms.has("web") ? "playwright" : platforms.has("ios") || platforms.has("android") ? "maestro" : platforms.size ? "playwright" : "api";
        const suggestedFile = tool === "maestro" ? ".maestro/".concat(slug(story.id), ".yaml") : tool === "playwright" ? "e2e/".concat(slug(story.id), ".spec.ts") : "tests/".concat(slug(story.id), ".test.ts");
        return story.acceptance.map((ac, i) => ({
            id: "".concat(story.id, "/AC", i + 1),
            story: story.id,
            text: "Given ".concat(ac.given, ", when ", ac.when, ", then ", ac.then),
            tool,
            suggestedFile,
        }));
    });
}
export function qaCoverage(root, options = {}) {
    const cases = qaPlan(root);
    const known = new Map(cases.map((c) => [c.id, c]));
    const filesByCase = new Map();
    const unknownTags = [];
    const listed = listProjectFiles(root);
    // Maestro flows live in a dot-directory that the non-git file walk skips.
    const maestro = existsSync(join(root, ".maestro")) ? readdirSync(join(root, ".maestro")).map((name) => ".maestro/".concat(name)) : [];
    const testFiles = [...new Set([...listed, ...maestro])].filter((file) => TEST_FILE.test(file) && /\.(?:[cm]?[jt]sx?|py|ya?ml|feature)$/.test(file));
    for (const file of testFiles) {
        let text;
        try {
            if (statSync(join(root, file)).size > 1_000_000)
                continue;
            text = readFileSync(join(root, file), "utf8");
        }
        catch {
            continue;
        }
        for (const match of text.matchAll(TAG)) {
            const tag = match[1] ?? "";
            if (known.has(tag)) {
                const set = filesByCase.get(tag) ?? new Set();
                set.add(file);
                filesByCase.set(tag, set);
            }
            else if (!unknownTags.some((u) => u.tag === tag && u.file === file)) {
                unknownTags.push({ tag, file });
            }
        }
    }
    const covered = [...filesByCase].map(([id, files]) => ({ id, files: [...files].sort() }));
    if (options.link) {
        for (const { id, files } of covered) {
            const story = known.get(id)?.story;
            for (const file of files)
                if (story)
                    linkTrace(root, "story:".concat(story), "test:".concat(file), "verifiedBy");
        }
    }
    const missing = cases.filter((c) => !filesByCase.has(c.id));
    return {
        required: cases.length,
        covered: covered.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
        missing,
        ratio: cases.length ? (cases.length - missing.length) / cases.length : 1,
        unknownTags,
        testFiles: testFiles.length,
    };
}
