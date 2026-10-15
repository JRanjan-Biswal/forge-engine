import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadArtifact } from "../core/artifacts.js";
import { loadConfig } from "../core/config.js";
import { auditDrift } from "../design/audit.js";
import { qaCoverage } from "../qa/coverage.js";
import type { Reviews } from "../schemas/artifacts.js";
import type { Severity } from "../security/rules.js";
import { scanSecurity, severityRank } from "../security/scan.js";
import { contractDrift, platformParity } from "../trace/drift.js";
import { computeGaps, scanPlaceholders } from "../trace/trace.js";

/**
 * CI checks for any repository (used by the forge review-action and gap-action):
 * the same deterministic checks as the verify and gap gates, reported as GitHub
 * annotations (inline on the PR diff) and a job summary. No LLM involved.
 */

export type CheckKind = "review" | "gap";
type Level = "error" | "warning" | "notice";

export interface Annotation {
  level: Level;
  title: string;
  message: string;
  file?: string;
  line?: number;
}

export interface CheckSection {
  name: string;
  status: "pass" | "fail" | "skip";
  summary: string;
  annotations: Annotation[];
}

export interface CiCheckResult {
  kind: CheckKind;
  ok: boolean;
  sections: CheckSection[];
}

const levelFor = (severity: Severity, failOn: Severity): Level =>
  severityRank(severity) <= severityRank(failOn) ? "error" : severity === "medium" ? "warning" : "notice";

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function reviewSections(root: string): CheckSection[] {
  const config = loadConfig(root);
  const { failOn, ignore } = config.security;
  const sections: CheckSection[] = [];

  const scan = scanSecurity(root, { ignore });
  const blocking = scan.findings.filter((f) => levelFor(f.severity, failOn) === "error");
  sections.push({
    name: "Security scan",
    status: blocking.length ? "fail" : "pass",
    summary: `${scan.filesScanned} files · ${scan.counts.critical} critical · ${scan.counts.high} high · ${scan.counts.medium} medium · ${scan.counts.low} low · ${scan.suppressed.length} suppressed with a reason`,
    annotations: [
      ...scan.findings.map((f) => ({ level: levelFor(f.severity, failOn), title: `${f.severity}: ${f.title} (${f.cwe})`, message: `${f.rule} — ${f.fix}`, file: f.file, line: f.line })),
      ...scan.invalidSuppressions.map((s) => ({ level: "warning" as const, title: "Suppression ignored", message: s.text, file: s.file, line: s.line })),
    ],
  });

  const reviews = safe(() => loadArtifact<Reviews>(root, "reviews"));
  if (reviews) {
    const open = reviews.findings.filter((f) => f.status === "open");
    const blockingReviews = open.filter((f) => f.severity === "critical" || f.severity === "high");
    sections.push({
      name: "Review findings",
      status: blockingReviews.length ? "fail" : "pass",
      summary: `${open.length} open (${blockingReviews.length} critical/high) of ${reviews.findings.length}`,
      annotations: open.map((f) => ({
        level: f.severity === "critical" || f.severity === "high" ? ("error" as const) : f.severity === "medium" ? ("warning" as const) : ("notice" as const),
        title: `${f.id} ${f.severity}: ${f.category}`,
        message: `${f.claim}${f.suggestedFix ? ` — fix: ${f.suggestedFix}` : ""}`,
        file: f.file,
        ...(f.line ? { line: f.line } : {}),
      })),
    });
  }

  const qa = safe(() => qaCoverage(root));
  if (qa) {
    const ok = qa.ratio >= config.gates.qa.minCoverage;
    sections.push({
      name: "QA coverage",
      status: ok ? "pass" : "fail",
      summary: `${qa.required - qa.missing.length}/${qa.required} MVP acceptance criteria have a tagged test`,
      annotations: [
        ...qa.missing.map((m) => ({ level: ok ? ("warning" as const) : ("error" as const), title: `No test for ${m.id}`, message: `${m.text} — tag a test @${m.id} (${m.tool}, e.g. ${m.suggestedFile})` })),
        ...qa.unknownTags.map((u) => ({ level: "warning" as const, title: `Unknown tag @${u.tag}`, message: "matches no acceptance criterion", file: u.file })),
      ],
    });
  }
  return sections;
}

function gapSections(root: string): CheckSection[] {
  const config = loadConfig(root);
  const sections: CheckSection[] = [];

  const gaps = computeGaps(root);
  if (gaps.required) {
    const ok = gaps.coverage >= config.gates.gap.minCoverage;
    sections.push({
      name: "Trace coverage",
      status: ok ? "pass" : "fail",
      summary: `${Math.round(gaps.coverage * 100)}% (${gaps.satisfied}/${gaps.required}) of MVP story requirements traced to design, code and tests`,
      annotations: gaps.gaps.map((g) => ({ level: ok ? ("warning" as const) : ("error" as const), title: `${g.story}: ${g.missing}`, message: g.message })),
    });
  }

  const drift = contractDrift(root);
  sections.push(
    drift.contract
      ? {
          name: "Contract drift",
          status: drift.missing.length || drift.undocumented.length ? "fail" : "pass",
          summary: `${drift.contract}: ${drift.operations} operations · ${drift.endpoints} endpoints · ${drift.missing.length} missing · ${drift.undocumented.length} undocumented`,
          annotations: [
            ...drift.missing.map((m) => ({ level: "error" as const, title: "Contract operation missing from the code", message: `${m.method} ${m.path}`, file: drift.contract })),
            ...drift.undocumented.map((u) => ({ level: "error" as const, title: "Endpoint not in the contract", message: `${u.method} ${u.route}`, file: u.file })),
          ],
        }
      : { name: "Contract drift", status: "skip", summary: "no contracts/openapi.yaml", annotations: [] },
  );

  const parity = platformParity(root);
  if (parity.groups.length > 1 && parity.stories.length) {
    sections.push({
      name: "Platform parity",
      status: parity.gaps.length ? "fail" : "pass",
      summary: `${parity.stories.length} MVP stories across ${parity.groups.join(" + ")}`,
      annotations: parity.gaps.map((g) => ({ level: "error" as const, title: `${g.id} has no ${g.missing.join(", ")} screens`, message: "design them, or list the story in gates.gap.parityExempt" })),
    });
  }

  const dirs = config.gates.gap.scanDirs;
  const placeholders = scanPlaceholders(root, dirs, 50);
  sections.push({
    name: "Placeholder data",
    status: placeholders.length ? "fail" : "pass",
    summary: `${placeholders.length} hit(s) in ${dirs.join(", ")}`,
    annotations: placeholders.map((h) => ({ level: "error" as const, title: "Placeholder or fake data in product code", message: h.text, file: h.file, line: h.line })),
  });

  if (existsSync(join(root, "design", "tokens"))) {
    const colours = safe(() => auditDrift(root, dirs)) ?? [];
    sections.push({
      name: "Design-token drift",
      status: colours.length ? "fail" : "pass",
      summary: `${colours.length} hard-coded colour(s)`,
      annotations: colours.map((d) => ({ level: "error" as const, title: "Hard-coded colour", message: `${d.value}${d.suggest ? ` → use ${d.suggest}` : ""}`, file: d.file, line: d.line })),
    });
  }
  return sections;
}

export function runCiCheck(root: string, kind: CheckKind): CiCheckResult {
  const sections = kind === "review" ? reviewSections(root) : gapSections(root);
  return { kind, ok: sections.every((s) => s.status !== "fail"), sections };
}

// ── GitHub output ────────────────────────────────────────────────────────────

const escapeData = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text: string) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** Workflow commands that GitHub turns into annotations (inline on the PR diff when file/line are set). */
export function githubAnnotations(result: CiCheckResult, max = 50): string[] {
  const order: Record<Level, number> = { error: 0, warning: 1, notice: 2 };
  return result.sections
    .flatMap((s) => s.annotations)
    .sort((a, b) => order[a.level] - order[b.level])
    .slice(0, max)
    .map((a) => {
      const props = [a.file ? `file=${escapeProperty(a.file)}` : "", a.line ? `line=${a.line}` : "", `title=${escapeProperty(a.title)}`].filter(Boolean).join(",");
      return `::${a.level} ${props}::${escapeData(a.message)}`;
    });
}

export function markdownSummary(result: CiCheckResult): string {
  const icon = { pass: "✅", fail: "❌", skip: "➖" } as const;
  const lines = [
    `## forge ${result.kind} — ${result.ok ? "passed" : "failed"}`,
    "",
    "| | Check | Result |",
    "|---|---|---|",
    ...result.sections.map((s) => `| ${icon[s.status]} | ${s.name} | ${s.summary.replace(/\|/g, "\\|")} |`),
  ];
  for (const section of result.sections.filter((s) => s.status === "fail")) {
    lines.push("", `### ${section.name}`, "");
    for (const a of section.annotations.filter((x) => x.level === "error").slice(0, 20)) {
      lines.push(`- ${a.file ? `\`${a.file}${a.line ? `:${a.line}` : ""}\` ` : ""}**${a.title}** — ${a.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Print annotations and append the job summary when running in GitHub Actions. */
export function reportToGithub(result: CiCheckResult, out: (line: string) => void): void {
  for (const line of githubAnnotations(result)) out(line);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, markdownSummary(result));
}
