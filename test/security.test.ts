import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadArtifact } from "../src/core/artifacts.js";
import { BUILTINS } from "../src/core/gates.js";
import { loadConfig } from "../src/core/config.js";
import { findStage } from "../src/core/stages.js";
import { Forge } from "../src/core/engine.js";
import { run } from "../src/cli.js";
import { analyzeHeaders, blockingHeaders, checkHeaders, PROBE_ORIGIN } from "../src/security/headers.js";
import { recordFindings, scanSecurity } from "../src/security/scan.js";
import type { Reviews } from "../src/schemas/artifacts.js";
import { editConfig, isolate, tempDir, tmpProject } from "./helpers.js";

isolate();

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

function put(root: string, file: string, content: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Scan one file's content and return the rule ids it triggers. */
function rulesFor(file: string, content: string): string[] {
  const root = tempDir();
  put(root, file, content);
  return scanSecurity(root).findings.map((f) => f.rule);
}

// [file, vulnerable line, expected rule, safe equivalent]
const CASES: [string, string, string, string][] = [
  ["src/a.ts", "const out = eval(req.body.code);", "js.eval", "const out = JSON.parse(req.body.code);"],
  ["src/a.ts", 'const fn = new Function("a", body);', "js.new-function", "const fn = handlers[name];"],
  ["src/a.ts", "exec(`git log ${branch}`);", "js.shell-interpolation", 'execFile("git", ["log", branch]);'],
  ["src/a.ts", 'child_process.execSync("convert " + file);', "js.shell-interpolation", 'child_process.execFileSync("convert", [file]);'],
  ["src/a.ts", "spawn(cmd, args, { shell: true });", "js.spawn-shell", "spawn(cmd, args);"],
  ["src/a.ts", "await db.query(`SELECT * FROM users WHERE id = ${id}`);", "js.sql-interpolation", 'await db.query("SELECT * FROM users WHERE id = $1", [id]);'],
  ["src/a.ts", `await db.query("SELECT * FROM t WHERE name = '" + name + "'");`, "js.sql-interpolation", "await sql`SELECT * FROM t WHERE name = ${name}`;"],
  ["src/a.ts", "await prisma.$queryRawUnsafe(query);", "js.prisma-unsafe", "await prisma.$queryRaw`SELECT 1`;"],
  ["src/a.ts", "const user = await User.findOne(req.body);", "js.nosql-operator-injection", "const user = await User.findOne({ email: input.email });"],
  ["src/a.ts", 'db.items.find({ $where: "this.a == 1" });', "nosql.where", "db.items.find({ a: 1 });"],
  ["src/a.tsx", "<div dangerouslySetInnerHTML={{ __html: comment.body }} />", "js.dangerously-set-inner-html", "<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.body) }} />"],
  ["src/a.ts", "el.innerHTML = message;", "js.inner-html", "el.textContent = message;"],
  ["src/a.ts", "res.send(`<p>Hello ${req.query.name}</p>`);", "js.reflected-input", "res.json({ name: input.name });"],
  ["src/a.ts", "const html = ejs.render(req.body.template, data);", "js.template-injection", 'const html = await ejs.renderFile("views/page.ejs", data);'],
  ["src/a.ts", "fs.readFile(path.join(base, req.params.name), cb);", "js.path-traversal", "fs.readFile(path.join(base, safeName(id)), cb);"],
  ["src/a.ts", "return res.redirect(req.query.next);", "js.open-redirect", 'return res.redirect("/dashboard");'],
  ["src/a.ts", "const r = await fetch(req.query.url);", "js.ssrf", "const r = await fetch(`${API_BASE}/items`);"],
  ["src/a.ts", 'res.setHeader("Content-Disposition", req.query.filename);', "js.header-injection", 'res.setHeader("Content-Disposition", "attachment");'],
  ["src/a.ts", 'res.setHeader("Access-Control-Allow-Origin", req.headers.origin);', "js.cors-reflect-header", 'res.setHeader("Access-Control-Allow-Origin", ALLOWED);'],
  ["src/a.ts", "https.request({ host, rejectUnauthorized: false });", "js.tls-verify-off", "https.request({ host, ca });"],
  ["src/a.ts", "const token = Math.random().toString(36).slice(2);", "js.insecure-random", "const token = crypto.randomUUID();"],
  ["src/a.ts", "vm.runInNewContext(code, sandbox);", "js.vm", "worker.postMessage(code);"],
  ["src/a.ts", "res.cookie('sid', id, { httpOnly: false });", "js.cookie-httponly-off", "res.cookie('sid', id, { httpOnly: true, secure: true });"],
  ["src/a.ts", "app.use(helmet({ contentSecurityPolicy: false }));", "js.csp-disabled", "app.use(helmet());"],
  ["src/a.ts", "jwt.verify(token, key, { algorithms: ['none'] });", "jwt.unverified", "jwt.verify(token, key, { algorithms: ['RS256'] });"],
  ["src/a.ts", 'const ser = require("node-serialize");', "js.unsafe-deserialize", "const data = JSON.parse(body);"],
  ["app/a.py", "cursor.execute(f\"SELECT * FROM users WHERE name = '{name}'\")", "py.sql-interpolation", 'cursor.execute("SELECT * FROM users WHERE name = %s", (name,))'],
  ["app/a.py", "cursor.execute(\"SELECT * FROM users WHERE name = '%s'\" % name)", "py.sql-interpolation", 'session.execute(text("SELECT 1 WHERE a = :a"), {"a": a})'],
  ["app/a.py", "subprocess.run(cmd, shell=True)", "py.shell-true", 'subprocess.run(["ls", d], check=True)'],
  ["app/a.py", 'os.system("ls " + d)', "py.os-system", 'subprocess.run(["ls", d])'],
  ["app/a.py", "result = eval(expr)", "py.eval-exec", "result = ast.literal_eval(expr)"],
  ["app/a.py", "obj = pickle.loads(data)", "py.pickle", "obj = json.loads(data)"],
  ["app/a.py", "cfg = yaml.load(f)", "py.yaml-load", "cfg = yaml.load(f, Loader=yaml.SafeLoader)"],
  ["app/a.py", 'return render_template_string(f"<h1>{name}</h1>")', "py.ssti", 'return render_template("hello.html", name=name)'],
  ["app/a.py", "r = requests.get(url, verify=False)", "py.tls-verify-off", "r = requests.get(url, timeout=5)"],
  ["app/a.py", 'return redirect(request.args.get("next"))', "py.open-redirect", 'return redirect(url_for("home"))'],
  ["app/a.py", "r = requests.get(request.args['url'])", "py.ssrf", "r = requests.get(SERVICE_URL)"],
  ["app/a.py", "f = open(os.path.join(BASE, request.args['name']))", "py.path-traversal", "f = open(BASE / safe_name(item_id))"],
  ["app/a.py", "token = ''.join(random.choice(ALPHABET) for _ in range(32))", "py.insecure-random", "token = secrets.token_urlsafe(32)"],
  ["app/a.py", "env = Environment(autoescape=False)", "py.autoescape-off", "env = Environment(autoescape=select_autoescape())"],
  ["app/a.py", "app.run(debug=True)", "py.debug-mode", 'app.run(debug=os.environ.get("DEBUG") == "1")'],
  ["templates/page.html", "<div>{{ body | safe }}</div>", "template.unescaped", "<div>{{ body }}</div>"],
];

describe("static security scan", () => {
  it.each(CASES)("%s: flags `%s` as %s and not its safe equivalent", (file, vulnerable, rule, safe) => {
    expect(rulesFor(file, `${vulnerable}\n`)).toContain(rule);
    expect(rulesFor(file, `${safe}\n`)).not.toContain(rule);
  });

  it("flags CORS any-origin only together with credentials (multi-line config)", () => {
    expect(rulesFor("src/server.ts", "app.use(cors({\n  origin: true,\n  credentials: true,\n}));\n")).toContain("js.cors-any-origin-credentials");
    expect(rulesFor("src/server.ts", "app.use(cors({ origin: true }));\n")).not.toContain("js.cors-any-origin-credentials");
    expect(rulesFor("app/main.py", 'app.add_middleware(\n    CORSMiddleware,\n    allow_origins=["*"],\n    allow_credentials=True,\n)\n')).toContain("py.cors-any-origin-credentials");
  });

  it("finds committed credentials without echoing them, and ignores env lookups and placeholders", () => {
    const key = ["AKIA", "Q7X2M9R4T6Y8U3W5"].join("");
    const password = ["Tr0ub4dor", "and", "3"].join("-");
    const root = tempDir();
    put(root, "src/config.ts", `export const awsKey = "${key}";\nexport const dbPassword = "${password}";\nexport const apiKey = process.env.API_KEY;\nexport const fallbackPassword = "changeme-please";\n`);
    const result = scanSecurity(root);
    expect(result.findings.map((f) => `${f.rule}:${f.line}`)).toEqual(["secret:1", "hardcoded-credential:2"]);
    expect(result.findings[0]?.severity).toBe("critical");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it("flags .env files that git would commit, not ignored ones or templates", () => {
    const root = tempDir();
    put(root, ".env", "DATABASE_URL=postgres://localhost/app\n");
    put(root, ".env.example", "DATABASE_URL=\n");
    expect(scanSecurity(root).findings.map((f) => `${f.rule}@${f.file}`)).toEqual(["env-file@.env"]);
    put(root, ".gitignore", ".env\n");
    spawnSync("git", ["init", "-q"], { cwd: root });
    expect(scanSecurity(root).findings).toEqual([]);
  });

  it("skips test code for injection rules but still catches real secrets there", () => {
    const root = tempDir();
    put(root, "tests/payloads.test.ts", "expect(eval('1+1')).toBe(2);\n");
    put(root, "src/__tests__/x.ts", `const k = "${["ghp_", "a".repeat(36)].join("")}";\n`);
    expect(scanSecurity(root).findings.map((f) => f.rule)).toEqual(["secret"]);
    expect(scanSecurity(root, { includeTests: true }).findings.map((f) => f.rule)).toContain("js.eval");
  });

  it("honours suppressions only with a reason, and reports reasonless ones", () => {
    const root = tempDir();
    put(root, "src/a.ts", "// forge-security-ignore js.eval -- evaluates a constant built at compile time\nconst x = eval(BUILD_EXPR);\nconst y = eval(other); // forge-security-ignore js.eval\n");
    put(root, "lib/upstream.js", "/* forge-security-ignore-file -- vendored upstream build, reviewed in ADR-0007 */\nnew Function(a);\n");
    put(root, "src/b.js", "// forge-security-ignore-file\nnew Function(a);\n");
    const result = scanSecurity(root);
    expect(result.suppressed.map((s) => `${s.rule}@${s.file}:${s.line}`).sort()).toEqual(["*@lib/upstream.js:1", "js.eval@src/a.ts:2"]);
    expect(result.findings.map((f) => `${f.rule}@${f.file}:${f.line}`).sort()).toEqual(["js.eval@src/a.ts:3", "js.new-function@src/b.js:2"]);
    expect(result.invalidSuppressions).toHaveLength(2);
    expect(scanSecurity(root, { ignore: ["src/**"] }).findings).toEqual([]);
  });

  it("files findings into the reviews artifact once", () => {
    const root = tmpProject();
    put(root, "src/a.ts", "const out = eval(req.body.code);\n");
    const result = scanSecurity(root);
    expect(recordFindings(root, result)).toEqual({ added: 1, total: 1 });
    expect(recordFindings(root, result)).toEqual({ added: 0, total: 1 });
    expect(loadArtifact<Reviews>(root, "reviews")?.findings[0]).toMatchObject({ id: "SEC-1", severity: "high", category: "security:js.eval", file: "src/a.ts", line: 1, status: "open" });
  });
});

describe("security headers", () => {
  const html = (h: Record<string, string>) => new Headers({ "content-type": "text/html; charset=utf-8", ...h });
  const check = (report: ReturnType<typeof analyzeHeaders>, id: string) => report.checks.find((c) => c.id === id);

  it("fails an HTML page without protections and names the fixes", () => {
    const report = analyzeHeaders("https://app.example/", 200, html({ "x-powered-by": "Express" }));
    expect(blockingHeaders(report, "high").map((c) => c.id).sort()).toEqual(["csp", "hsts"]);
    expect(check(report, "clickjacking")).toMatchObject({ status: "fail", severity: "medium" });
    expect(check(report, "nosniff")).toMatchObject({ status: "fail" });
    expect(check(report, "info-leak")).toMatchObject({ status: "warn", detail: expect.stringContaining("X-Powered-By: Express") });
    expect(check(report, "csp")?.fix).toMatch(/nonce/);
  });

  it("passes a hardened page", () => {
    const report = analyzeHeaders(
      "https://app.example/",
      200,
      html({
        "content-security-policy": "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "strict-transport-security": "max-age=63072000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=()",
        "cross-origin-opener-policy": "same-origin",
        "set-cookie": "__Host-sid=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
      }),
    );
    expect(report.checks.filter((c) => c.status !== "pass")).toEqual([]);
  });

  it("catches weak CSP, short HSTS, bad cookies and reflected CORS with credentials", () => {
    const headers = html({
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "strict-transport-security": "max-age=3600",
      "access-control-allow-origin": PROBE_ORIGIN,
      "access-control-allow-credentials": "true",
    });
    headers.append("set-cookie", "session=abc; Path=/");
    headers.append("set-cookie", "theme=dark; SameSite=None");
    const report = analyzeHeaders("https://app.example/", 200, headers);
    expect(check(report, "csp")?.detail).toMatch(/unsafe-inline.*unsafe-eval/);
    expect(check(report, "hsts")).toMatchObject({ status: "fail", severity: "medium" });
    expect(check(report, "cors")).toMatchObject({ status: "fail", severity: "critical" });
    expect(check(report, "cookie:session")).toMatchObject({ status: "fail", severity: "high", detail: expect.stringContaining("HttpOnly") });
    expect(check(report, "cookie:theme")?.detail).toMatch(/SameSite=None without Secure/);
  });

  it("says when it only saw a redirect, not the page", () => {
    const report = analyzeHeaders("https://app.example/", 302, new Headers({ "content-type": "text/plain", location: "https://vercel.com/sso-api?url=x&nonce=abc" }));
    expect(report.checks.find((c) => c.id === "redirect")).toMatchObject({ status: "warn", detail: expect.stringMatching(/^HTTP 302 → https:\/\/vercel\.com\/sso-api — these are the redirect's headers/) });
    expect(JSON.stringify(report)).not.toContain("nonce");
  });

  it("treats JSON APIs differently and does not demand HSTS over plain http", () => {
    const report = analyzeHeaders("http://localhost:8000/api", 200, new Headers({ "content-type": "application/json", "x-content-type-options": "nosniff" }));
    expect(report.kind).toBe("api");
    expect(blockingHeaders(report, "medium")).toEqual([]);
    expect(check(report, "csp")).toMatchObject({ status: "warn", severity: "low" });
    expect(check(report, "hsts")?.status).toBe("info");
  });

  it("probes a real running server with a foreign Origin", async () => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.setHeader("access-control-allow-origin", req.headers.origin ?? "");
      res.setHeader("access-control-allow-credentials", "true");
      res.end("<h1>hi</h1>");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const report = await checkHeaders(`http://127.0.0.1:${port}/`);
    expect(report.status).toBe(200);
    expect(report.checks.find((c) => c.id === "cors")).toMatchObject({ status: "fail", severity: "critical" });
    await expect(checkHeaders("http://127.0.0.1:9/", { timeoutMs: 2_000 })).rejects.toThrow(/Could not reach/);
    await expect(checkHeaders("file:///etc/passwd")).rejects.toThrow(/Only http/);
  });
});

describe("verify gate and CLI", () => {
  it("the verify gate runs the scan and the header check itself", async () => {
    const root = tmpProject();
    const stage = findStage("verify")!;
    const ctx = () => ({ root, config: loadConfig(root), stage, state: new Forge(root).readState() });
    expect(stage.gate.map((c) => c.id)).toEqual(expect.arrayContaining(["security-scan", "security-headers", "audit"]));
    expect(await BUILTINS["security.scan"]!(ctx())).toMatchObject({ status: "pass" });
    put(root, "src/db.ts", "db.query(`SELECT * FROM users WHERE id = ${id}`);\n");
    expect(await BUILTINS["security.scan"]!(ctx())).toMatchObject({ status: "fail", message: expect.stringMatching(/critical js\.sql-interpolation src\/db\.ts:1/) });
    editConfig(root, (text) => text.replace("ignore: []", "ignore: [src/db.ts]"));
    expect(await BUILTINS["security.scan"]!(ctx())).toMatchObject({ status: "pass" });

    expect(await BUILTINS["security.headers"]!(ctx())).toMatchObject({ status: "skip" });
    editConfig(root, (text) => text.replace(/^ {2}url:.*$/m, '  url: "http://127.0.0.1:9/"'));
    expect(await BUILTINS["security.headers"]!(ctx())).toMatchObject({ status: "fail", message: expect.stringMatching(/Could not reach/) });
  });

  it("forge security scan exits 1 on blocking findings and can record them", async () => {
    const root = tmpProject();
    put(root, "app/main.py", "import os\nos.system(cmd)\n");
    const out: string[] = [];
    const io = { out: (l: string) => out.push(l), err: () => undefined };
    expect(await run(["security", "scan", "--root", root], io)).toBe(1);
    expect(out.join("\n")).toMatch(/HIGH +py\.os-system[\s\S]*FAIL — 1 at high/);
    out.length = 0;
    expect(await run(["security", "scan", "--record", "--json", "--root", root], io)).toBe(1);
    expect(JSON.parse(out.join("\n"))).toMatchObject({ blocking: 1, recorded: { added: 1 } });
    expect(await run(["security", "nope", "--root", root], io)).toBe(2);
  });
});
