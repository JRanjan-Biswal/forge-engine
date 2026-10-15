import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as S from "../schemas/artifacts.js";
import { ProductModel } from "../schemas/product.js";
import { assertNoSecrets } from "../memory/secrets.js";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./paths.js";
import { errorMessage, formatIssues } from "./util.js";
const defs = [
    { name: "brainstorm", path: ".forge/artifacts/brainstorm.json", format: "json", schema: S.Brainstorm, description: "Ideas generated in the brainstorm stage and the chosen one" },
    { name: "vision", path: ".forge/artifacts/vision.json", format: "json", schema: S.Vision, description: "North star, principles, anti-goals and success metrics" },
    { name: "validation", path: ".forge/artifacts/validation.json", format: "json", schema: S.Validation, description: "Binary validation scorecard with cited evidence and a verdict" },
    { name: "competitors", path: ".forge/artifacts/competitors.json", format: "json", schema: S.Competitors, description: "Competitor teardown: features, pricing, complaints, opportunities" },
    { name: "personas", path: ".forge/artifacts/personas.json", format: "json", schema: S.Personas, description: "Evidence-backed (or labelled synthetic) personas and jobs to be done" },
    { name: "prd", path: ".forge/artifacts/prd.json", format: "json", schema: S.Prd, description: "Goals, non-goals, user stories with Given/When/Then, metrics" },
    { name: "screens", path: "design/screens.json", format: "json", schema: S.Screens, description: "Screen inventory linked to stories, with UI states" },
    { name: "motion", path: "design/motion.json", format: "json", schema: S.Motion, description: "Motion specs: triggers, tokens, reduced-motion fallbacks" },
    { name: "architecture", path: ".forge/artifacts/architecture.md", format: "text", description: "System architecture overview" },
    { name: "openapi", path: "contracts/openapi.yaml", format: "text", description: "API contract (contract-first)" },
    { name: "tasks", path: ".forge/artifacts/tasks.json", format: "json", schema: S.Tasks, description: "Task DAG linked to stories" },
    { name: "reviews", path: ".forge/reviews/findings.json", format: "json", schema: S.Reviews, description: "Review findings with severity and status" },
    { name: "trace", path: ".forge/graph/trace.json", format: "json", schema: S.Trace, description: "Traceability graph: story → screen → code → test → release" },
    { name: "release", path: ".forge/releases/latest.json", format: "json", schema: S.Release, description: "Latest release record with checks and rollback plan" },
    { name: "launch", path: ".forge/artifacts/launch.md", format: "text", description: "Launch plan and kit" },
    { name: "product", path: ".forge/product/model.json", format: "json", schema: ProductModel, description: "Model of an existing product: personas, features linked to pages/endpoints/files, gaps, facts vs assumptions" },
];
export const ARTIFACTS = Object.fromEntries(defs.map((def) => [def.name, def]));
export class ArtifactError extends Error {
    name = "ArtifactError";
}
export function getArtifactDef(name) {
    const def = ARTIFACTS[name];
    if (!def) {
        throw new ArtifactError("Unknown artifact \"".concat(name, "\". Known: ", Object.keys(ARTIFACTS).join(", ")));
    }
    return def;
}
export function checkArtifact(root, name) {
    const def = getArtifactDef(name);
    const file = join(root, def.path);
    const result = (valid, errors = []) => ({
        name,
        path: def.path,
        exists: true,
        valid,
        errors,
    });
    if (!existsSync(file))
        return { name, path: def.path, exists: false, valid: false, errors: ["missing"] };
    if (def.format === "text") {
        return readFileSync(file, "utf8").trim() ? result(true) : result(false, ["empty"]);
    }
    let data;
    try {
        data = readJson(file);
    }
    catch (error) {
        return result(false, ["invalid JSON: ".concat(errorMessage(error))]);
    }
    if (!def.schema)
        return result(true);
    const parsed = def.schema.safeParse(data);
    return parsed.success ? result(true) : result(false, formatIssues(parsed.error).split("\n"));
}
/**
 * Load a JSON artifact with schema defaults applied. Returns undefined when the
 * file does not exist and throws ArtifactError when it exists but is invalid.
 */
export function loadArtifact(root, name) {
    const def = getArtifactDef(name);
    const file = join(root, def.path);
    if (!existsSync(file))
        return undefined;
    if (def.format === "text")
        return readFileSync(file, "utf8");
    let data;
    try {
        data = readJson(file);
    }
    catch (error) {
        throw new ArtifactError("".concat(def.path, " is not valid JSON: ", errorMessage(error)));
    }
    if (!def.schema)
        return data;
    const parsed = def.schema.safeParse(data);
    if (!parsed.success)
        throw new ArtifactError("".concat(def.path, " is invalid:\n", formatIssues(parsed.error)));
    return parsed.data;
}
export function readArtifactText(root, name) {
    const file = join(root, getArtifactDef(name).path);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}
/** Validate then write. JSON artifacts may be passed as objects or JSON strings. */
export function writeArtifact(root, name, data) {
    const def = getArtifactDef(name);
    const file = join(root, def.path);
    if (def.format === "text") {
        if (typeof data !== "string" || !data.trim()) {
            throw new ArtifactError("".concat(name, " is a text artifact; pass non-empty text"));
        }
        assertNoSecrets(data, def.path);
        writeTextAtomic(file, data.endsWith("\n") ? data : "".concat(data, "\n"));
        return { path: def.path };
    }
    let value = data;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        }
        catch {
            throw new ArtifactError("".concat(name, " expects JSON"));
        }
    }
    if (def.schema) {
        const parsed = def.schema.safeParse(value);
        if (!parsed.success) {
            throw new ArtifactError("".concat(name, " does not match its schema:\n", formatIssues(parsed.error)));
        }
        value = parsed.data;
    }
    const text = "".concat(JSON.stringify(value, null, 2), "\n");
    assertNoSecrets(text, def.path);
    writeJsonAtomic(file, value);
    return { path: def.path };
}
export function listArtifacts(root) {
    return Object.keys(ARTIFACTS).map((name) => checkArtifact(root, name));
}
