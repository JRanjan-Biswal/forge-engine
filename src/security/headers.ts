import type { Severity } from "./rules.js";

/**
 * Live check of a running app's HTTP response: security headers (CSP, HSTS,
 * clickjacking, nosniff, referrer, permissions, isolation), cookie flags, CORS
 * behaviour for a foreign Origin, and information leaks. One GET, no redirects
 * followed, short timeout — safe to point at a local dev server or a preview URL.
 */

export interface HeaderCheck {
  id: string;
  status: "pass" | "fail" | "warn" | "info";
  /** Severity when the check fails or warns. */
  severity: Severity;
  detail: string;
  fix?: string;
}

export interface HeaderReport {
  url: string;
  status: number;
  contentType: string;
  kind: "html" | "api";
  https: boolean;
  checks: HeaderCheck[];
}

/** An origin no app allow-lists; if it is echoed back, the policy reflects any origin. */
export const PROBE_ORIGIN = "https://forge-cors-probe.invalid";
const SESSION_COOKIE = /sess|sid|auth|token|jwt|login|remember/i;

const rank = (s: Severity) => ["critical", "high", "medium", "low"].indexOf(s);

export async function checkHeaders(url: string, options: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<HeaderReport> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Only http(s) URLs can be checked: ${url}`);
  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: "manual",
      headers: { Origin: PROBE_ORIGIN, "User-Agent": "forge-security-headers/1", ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const cause = (error as Error).cause;
    throw new Error(`Could not reach ${url}: ${cause instanceof Error ? cause.message : (error as Error).message}`);
  }
  await response.body?.cancel().catch(() => undefined);
  return analyzeHeaders(parsed.href, response.status, response.headers);
}

/** Pure analysis — exported for tests and for headers captured elsewhere. */
export function analyzeHeaders(url: string, status: number, headers: Headers): HeaderReport {
  const https = url.startsWith("https:");
  const contentType = headers.get("content-type") ?? "";
  const kind: HeaderReport["kind"] = /text\/html|application\/xhtml/i.test(contentType) ? "html" : "api";
  const html = kind === "html";
  const checks: HeaderCheck[] = [];
  const add = (check: HeaderCheck) => checks.push(check);
  const get = (name: string) => headers.get(name)?.trim() ?? "";

  // ── Redirects ─────────────────────────────────────────────────────────────
  const location = get("location");
  if (status >= 300 && status < 400 && location) {
    let target = location;
    try {
      const next = new URL(location, url);
      target = `${next.origin}${next.pathname}`;
    } catch {
      // keep the raw value
    }
    add({
      id: "redirect",
      status: "warn",
      severity: "medium",
      detail: `HTTP ${status} → ${target} — these are the redirect's headers, not the page's; check the final URL`,
      fix: "Point the check at the URL that serves the page (or provide the deployment-protection bypass header).",
    });
  }

  // ── Content-Security-Policy ───────────────────────────────────────────────
  const csp = get("content-security-policy");
  const directives = parseCsp(csp);
  if (!csp) {
    add({
      id: "csp",
      status: html ? "fail" : "warn",
      severity: html ? "high" : "low",
      detail: get("content-security-policy-report-only") ? "only Content-Security-Policy-Report-Only is set (nothing is enforced)" : "no Content-Security-Policy",
      fix: html
        ? "Send a nonce-based CSP: default-src 'self'; script-src 'self' 'nonce-<random>' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        : "APIs: Content-Security-Policy: default-src 'none'; frame-ancestors 'none'",
    });
  } else {
    const script = directives.get("script-src") ?? directives.get("default-src") ?? [];
    const problems: string[] = [];
    const nonceOrHash = script.some((s) => /^'(?:nonce|sha256|sha384|sha512)-/.test(s));
    if (script.includes("'unsafe-inline'") && !nonceOrHash) problems.push("script-src allows 'unsafe-inline'");
    if (script.includes("'unsafe-eval'")) problems.push("script-src allows 'unsafe-eval'");
    const wide = script.filter((s) => /^(?:\*|https?:|data:)$/.test(s));
    if (wide.length) problems.push(`script-src allows any source (${wide.join(" ")})`);
    if (!directives.has("script-src") && !directives.has("default-src")) problems.push("no script-src or default-src");
    if (html && !(directives.get("object-src") ?? directives.get("default-src") ?? []).includes("'none'")) problems.push("object-src is not 'none'");
    if (html && !directives.has("base-uri")) problems.push("no base-uri");
    add(
      problems.length
        ? { id: "csp", status: "fail", severity: "medium", detail: `weak CSP: ${problems.join("; ")}`, fix: "Use nonces or hashes instead of 'unsafe-inline'/'unsafe-eval'; set object-src 'none' and base-uri 'none'." }
        : { id: "csp", status: "pass", severity: "high", detail: "Content-Security-Policy set without unsafe script sources" },
    );
  }

  // ── Clickjacking ──────────────────────────────────────────────────────────
  const frameAncestors = directives.get("frame-ancestors");
  const xfo = get("x-frame-options").toUpperCase();
  if (frameAncestors?.length || xfo === "DENY" || xfo === "SAMEORIGIN") {
    add({ id: "clickjacking", status: "pass", severity: "medium", detail: frameAncestors?.length ? `frame-ancestors ${frameAncestors.join(" ")}` : `X-Frame-Options ${xfo}` });
  } else {
    add({
      id: "clickjacking",
      status: html ? "fail" : "info",
      severity: "medium",
      detail: "page can be framed by any site (no frame-ancestors, no X-Frame-Options)",
      fix: "CSP frame-ancestors 'none' (or 'self'); X-Frame-Options: DENY for old browsers.",
    });
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  const hsts = get("strict-transport-security");
  if (!https) {
    add({ id: "hsts", status: "info", severity: "high", detail: "not HTTPS — check HSTS on the deployed HTTPS URL" });
  } else if (!hsts) {
    add({ id: "hsts", status: "fail", severity: "high", detail: "no Strict-Transport-Security", fix: "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload" });
  } else {
    const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? 0);
    add(
      maxAge >= 15_552_000
        ? { id: "hsts", status: "pass", severity: "high", detail: hsts }
        : { id: "hsts", status: "fail", severity: "medium", detail: `HSTS max-age ${maxAge}s is under 180 days`, fix: "max-age=63072000 (2 years); includeSubDomains" },
    );
  }

  // ── Other headers ─────────────────────────────────────────────────────────
  add(
    get("x-content-type-options").toLowerCase() === "nosniff"
      ? { id: "nosniff", status: "pass", severity: "medium", detail: "X-Content-Type-Options: nosniff" }
      : { id: "nosniff", status: "fail", severity: "medium", detail: "no X-Content-Type-Options: nosniff (MIME sniffing can turn uploads into scripts)", fix: "X-Content-Type-Options: nosniff" },
  );
  const referrer = get("referrer-policy").toLowerCase();
  if (!referrer) {
    add({ id: "referrer-policy", status: html ? "warn" : "info", severity: "low", detail: "no Referrer-Policy (browser default applies)", fix: "Referrer-Policy: strict-origin-when-cross-origin" });
  } else if (/unsafe-url|no-referrer-when-downgrade/.test(referrer)) {
    add({ id: "referrer-policy", status: "fail", severity: "medium", detail: `Referrer-Policy ${referrer} leaks full URLs (tokens in query strings)`, fix: "Referrer-Policy: strict-origin-when-cross-origin" });
  } else {
    add({ id: "referrer-policy", status: "pass", severity: "low", detail: `Referrer-Policy ${referrer}` });
  }
  if (html) {
    add(
      get("permissions-policy")
        ? { id: "permissions-policy", status: "pass", severity: "low", detail: "Permissions-Policy set" }
        : { id: "permissions-policy", status: "warn", severity: "low", detail: "no Permissions-Policy", fix: "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()" },
    );
    add(
      get("cross-origin-opener-policy")
        ? { id: "coop", status: "pass", severity: "low", detail: `Cross-Origin-Opener-Policy ${get("cross-origin-opener-policy")}` }
        : { id: "coop", status: "warn", severity: "low", detail: "no Cross-Origin-Opener-Policy", fix: "Cross-Origin-Opener-Policy: same-origin" },
    );
  }

  // ── Information leaks ─────────────────────────────────────────────────────
  const leaks = [
    get("x-powered-by") && `X-Powered-By: ${get("x-powered-by")}`,
    /\d/.test(get("server")) && `Server: ${get("server")}`,
    get("x-aspnet-version") && `X-AspNet-Version: ${get("x-aspnet-version")}`,
  ].filter(Boolean);
  add(
    leaks.length
      ? { id: "info-leak", status: "warn", severity: "low", detail: `stack details exposed (${leaks.join(", ")})`, fix: "Remove X-Powered-By (Next.js: poweredByHeader: false; Express: app.disable('x-powered-by')) and version numbers from Server." }
      : { id: "info-leak", status: "pass", severity: "low", detail: "no framework/version headers" },
  );

  // ── Cookies ───────────────────────────────────────────────────────────────
  for (const cookie of headers.getSetCookie()) {
    const [pair = "", ...attributes] = cookie.split(";").map((part) => part.trim());
    const name = pair.split("=")[0] || "?";
    const attrs = attributes.map((a) => a.toLowerCase());
    const has = (flag: string) => attrs.some((a) => a === flag || a.startsWith(`${flag}=`));
    const sameSite = attrs.find((a) => a.startsWith("samesite="))?.split("=")[1];
    const problems: { text: string; severity: Severity }[] = [];
    if (SESSION_COOKIE.test(name) && !/csrf|xsrf/i.test(name) && !has("httponly")) problems.push({ text: "no HttpOnly (readable by injected scripts)", severity: "high" });
    if (sameSite === "none" && !has("secure")) problems.push({ text: "SameSite=None without Secure (rejected by browsers)", severity: "high" });
    else if (!has("secure")) problems.push({ text: "no Secure", severity: https ? "high" : "medium" });
    if (!sameSite) problems.push({ text: "no SameSite (set Lax or Strict explicitly)", severity: "low" });
    const worst = problems.map((p) => p.severity).sort((a, b) => rank(a) - rank(b))[0];
    add(
      worst
        ? { id: `cookie:${name}`, status: rank(worst) <= rank("medium") ? "fail" : "warn", severity: worst, detail: problems.map((p) => p.text).join("; "), fix: "Set-Cookie: <name>=…; HttpOnly; Secure; SameSite=Lax; Path=/" }
        : { id: `cookie:${name}`, status: "pass", severity: "low", detail: "HttpOnly/Secure/SameSite set" },
    );
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  const acao = get("access-control-allow-origin");
  const allowsCookies = get("access-control-allow-credentials").toLowerCase() === "true";
  if (!acao) {
    add({ id: "cors", status: "pass", severity: "high", detail: "no CORS access granted to a foreign origin" });
  } else if (acao === PROBE_ORIGIN) {
    add({
      id: "cors",
      status: "fail",
      severity: allowsCookies ? "critical" : "medium",
      detail: `reflects any Origin${allowsCookies ? " and allows cookies — any website can read logged-in responses" : ""}`,
      fix: "Echo the Origin only when it is in an explicit allow-list; add Vary: Origin.",
    });
  } else if (acao === "null") {
    add({ id: "cors", status: "fail", severity: allowsCookies ? "high" : "medium", detail: "Access-Control-Allow-Origin: null (sandboxed iframes and file: pages qualify)", fix: "Never allow the null origin." });
  } else if (acao === "*") {
    add(
      allowsCookies
        ? { id: "cors", status: "fail", severity: "high", detail: "Access-Control-Allow-Origin * while cookies are allowed", fix: "List origins explicitly when cookies are allowed." }
        : { id: "cors", status: "warn", severity: "low", detail: "Access-Control-Allow-Origin * (fine only for public, unauthenticated data)" },
    );
  } else {
    add({ id: "cors", status: "pass", severity: "high", detail: `allows ${acao} only` });
  }

  return { url, status, contentType, kind, https, checks };
}

function parseCsp(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), values);
  }
  return map;
}

/** Failing checks at or above `failOn`. */
export function blockingHeaders(report: HeaderReport, failOn: Severity): HeaderCheck[] {
  return report.checks.filter((check) => check.status === "fail" && rank(check.severity) <= rank(failOn));
}
