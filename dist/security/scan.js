// forge-security-ignore-file -- scanner implementation; contains detection patterns
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadArtifact, writeArtifact } from "../core/artifacts.js";
import { withLock } from "../core/lock.js";
import { findSecrets } from "../memory/secrets.js";
import { listProjectFiles } from "../product/scan.js";
import { RULES } from "./rules.js";
const SEVERITY_ORDER = ["critical", "high", "medium", "low"];
export const severityRank = (s) => SEVERITY_ORDER.indexOf(s);
const LANG_BY_EXT = [
    [/\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/, "js"],
    [/\.py$/, "py"],
    [/\.(?:html?|jinja2?|j2|hbs|handlebars|ejs|njk|liquid)$/, "template"],
];
const TEXT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|html?|jinja2?|j2|hbs|handlebars|ejs|njk|liquid|json|ya?ml|toml|ini|cfg|conf|properties|sh|bash|zsh|rb|go|java|kt|swift|dart|rs|cs|php|tf|sql|xml|gradle|plist|md)$/i;
const TEST = /(^|\/)(__tests__|tests?|e2e|fixtures|__mocks__|spec|cypress|playwright)\/|\.(test|spec|stories|e2e)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.py$|(^|\/)conftest\.py$/i;
const SKIP = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$|\.min\.[cm]?js$|\.map$/;
const ENV_FILE = /(^|\/)\.env(\.[\w-]+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist|defaults?)$/;
const IGNORE = /forge-security-ignore(?!-file)\s+([\w.,\s-]+?)\s*(?:--\s*(.+?))?\s*(?:\*\/|-->|#\}|%\})?\s*$/;
const IGNORE_FILE = /forge-security-ignore-file\b\s*(?:--\s*(.+?))?\s*(?:\*\/|-->)?\s*$/;
/** Generic hard-coded credential: a secret-named key assigned a literal that is not obviously a placeholder. */
const CREDENTIAL = /\b\w*?(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\w*["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;
const NOT_A_CREDENTIAL = /process\.env|import\.meta\.env|os\.environ|getenv|\$\{|\{\{|<[a-z_-]+>|example|change[_-]?me|your[_-]|xxxx|\*\*\*|placeholder|redacted|dummy|sample|fake/i;
const reasonOk = (reason) => Boolean(reason && reason.trim().split(/\s+/).length >= 3);
export function scanSecurity(root, options = {}) {
    const ignored = (options.ignore ?? []).map(globToRegExp);
    const files = listProjectFiles(root).filter((file) => !SKIP.test(file) && !ignored.some((g) => g.test(file)));
    const findings = [];
    const suppressed = [];
    const invalidSuppressions = [];
    let filesScanned = 0;
    for (const file of files) {
        const envFile = ENV_FILE.test(file) && !ENV_TEMPLATE.test(file);
        if (envFile) {
            findings.push({
                rule: "env-file",
                title: "Environment file is not gitignored",
                severity: "high",
                cwe: "CWE-538",
                file,
                line: 1,
                snippet: basename(file),
                fix: "Add it to .gitignore, rotate any secrets it held, and commit a .env.example with names only.",
            });
        }
        if (!TEXT.test(file) && !envFile)
            continue;
        let text;
        try {
            const abs = join(root, file);
            if (statSync(abs).size > 1_000_000)
                continue;
            text = readFileSync(abs, "utf8");
        }
        catch {
            continue;
        }
        filesScanned++;
        const lines = text.split("\n");
        const headerIndex = lines.slice(0, 10).findIndex((line) => IGNORE_FILE.test(line));
        if (headerIndex >= 0) {
            const reason = IGNORE_FILE.exec(lines[headerIndex] ?? "")?.[1];
            if (reasonOk(reason)) {
                suppressed.push({ rule: "*", file, line: headerIndex + 1, reason: reason?.trim() ?? "" });
                continue;
            }
            invalidSuppressions.push({ file, line: headerIndex + 1, text: "forge-security-ignore-file needs a reason (-- <why>, at least 3 words)" });
        }
        const lang = LANG_BY_EXT.find(([pattern]) => pattern.test(file))?.[1];
        const isTest = TEST.test(file);
        const codeRules = lang && (!isTest || options.includeTests) ? RULES.filter((rule) => rule.langs.includes(lang) && (!rule.fileAlso || rule.fileAlso.test(text))) : [];
        lines.forEach((raw, index) => {
            if (raw.length > 2_000)
                return; // minified or generated
            const hits = findSecrets(raw).map((label) => ({
                rule: "secret",
                title: `Committed credential (${label})`,
                severity: "critical",
                cwe: "CWE-798",
                fix: "Remove it, rotate the credential now, and load it from the environment or a secret store.",
            }));
            const credential = CREDENTIAL.exec(raw);
            if (!isTest && !hits.length && credential?.[1] && !NOT_A_CREDENTIAL.test(raw)) {
                hits.push({ rule: "hardcoded-credential", title: "Hard-coded credential", severity: "high", cwe: "CWE-798", fix: "Load it from the environment or a secret store; rotate it if it was ever real." });
            }
            for (const rule of codeRules) {
                if (rule.pattern.test(raw) && !rule.unless?.test(raw)) {
                    hits.push({ rule: rule.id, title: rule.title, severity: rule.severity, cwe: rule.cwe, fix: rule.fix });
                }
            }
            if (!hits.length)
                return;
            const comments = [raw, lines[index - 1] ?? ""].map((line) => IGNORE.exec(line)).filter((m) => m !== null);
            for (const hit of hits) {
                const match = comments.find((m) => (m[1] ?? "").split(/[\s,]+/).includes(hit.rule));
                if (match && reasonOk(match[2])) {
                    suppressed.push({ rule: hit.rule, file, line: index + 1, reason: (match[2] ?? "").trim() });
                    continue;
                }
                if (match)
                    invalidSuppressions.push({ file, line: index + 1, text: `${hit.rule}: suppression needs a reason (-- <why>, at least 3 words)` });
                findings.push({ ...hit, file, line: index + 1, snippet: redact(raw.trim()).slice(0, 200) });
            }
        });
    }
    findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of findings)
        counts[finding.severity]++;
    return { findings, suppressed, invalidSuppressions, filesScanned, counts };
}
/** Findings at or above `failOn` block the gate. */
export function blocking(result, failOn) {
    return result.findings.filter((finding) => severityRank(finding.severity) <= severityRank(failOn));
}
/** Snippets end up in reports, reviews and memory — never echo a secret value. */
function redact(line) {
    const quoted = CREDENTIAL.test(line) || findSecrets(line).length ? line.replace(/(["'])[^"'\s]{8,}\1/g, "$1[REDACTED]$1") : line;
    return quoted.replace(/\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:sk|rk)_live_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,})\S*/g, "[REDACTED]");
}
function globToRegExp(glob) {
    const source = glob
        .replace(/[.+^$()|[\]\\{}]/g, "\\$&")
        .replace(/\*\*\//g, "\u0000")
        .replace(/\*\*/g, "\u0001")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, "(?:.*/)?")
        .replace(/\u0001/g, ".*");
    return new RegExp(`^${source}(?:/.*)?$`);
}
/**
 * File scan findings into the `reviews` artifact (category `security:<rule>`), once
 * per rule+file+line, so the review → fix → verify loop tracks them. The verify gate
 * still re-runs the scan itself — editing a finding's status cannot hide a sink.
 */
export function recordFindings(root, result) {
    return withLock(root, () => {
        const reviews = loadArtifact(root, "reviews") ?? { findings: [] };
        const key = (category, file, line) => `${category}|${file}|${line ?? ""}`;
        const known = new Set(reviews.findings.map((f) => key(f.category, f.file, f.line)));
        let next = reviews.findings.filter((f) => /^SEC-\d+$/.test(f.id)).reduce((max, f) => Math.max(max, Number(f.id.slice(4))), 0);
        let added = 0;
        for (const finding of result.findings) {
            const category = `security:${finding.rule}`;
            if (known.has(key(category, finding.file, finding.line)))
                continue;
            known.add(key(category, finding.file, finding.line));
            reviews.findings.push({
                id: `SEC-${++next}`,
                severity: finding.severity,
                category,
                file: finding.file,
                line: finding.line,
                claim: `${finding.title} (${finding.cwe})`,
                evidence: `forge security scan: ${finding.snippet}`,
                suggestedFix: finding.fix,
                status: "open",
            });
            added++;
        }
        writeArtifact(root, "reviews", reviews);
        return { added, total: reviews.findings.length };
    });
}
