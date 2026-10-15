---
name: security-review
description: forge's security review — threat model first, then the deterministic scan (injection sinks, secrets, env files), the live header/cookie/CORS check on the running app, dependency audit, and a manual source→sink review for code injection, SQL/NoSQL/command/template injection, XSS, SSRF, path traversal, open redirects, authn/authz (IDOR, tenancy), CSRF, security headers, cookies, crypto, file uploads, rate limits and LLM prompt injection. Every finding gets an exploit scenario, CWE, fix and a regression test. Use for the verify stage, before every ship, and on any change that touches input handling, auth, sessions, headers, files, outbound requests or secrets.
---

# Security review (forge `verify` stage — and before every `ship`)

**Produces:** findings in the `reviews` artifact (`.forge/reviews/findings.json`) with `category: "security:<area>"`. **Gate:** the verify stage re-runs `security.scan` (static) and `security.headers` (live, when `security.url` is set) itself, plus `commands.audit` when configured — editing a finding's status cannot hide a sink.

Mindset: every value that crosses a trust boundary is hostile — request body, query, path params, headers, cookies, uploaded files, webhooks, third-party API responses, database content written by users, and **LLM output**. Prove reachability before calling something exploitable; prove a fix with a test that sends the hostile input.

## 1. Threat model (short, written down)
- **Assets:** accounts, sessions, personal data, payments, admin functions, secrets, other tenants' data.
- **Entry points:** every page and endpoint from `product_map`, plus webhooks, cron jobs, queues, file uploads, deep links (mobile).
- **Trust boundaries:** browser ↔ server, server ↔ database, server ↔ third parties, tenant ↔ tenant, user ↔ admin.
- One line of STRIDE per boundary. It tells you where to look hardest.

## 2. Automated passes (deterministic — run them, don't guess)
1. `security_scan` with `record: true` (CLI `forge security scan --record`): code/SQL/NoSQL/shell/template injection, XSS sinks, path traversal, SSRF, open redirects, header injection, unsafe deserialization, TLS verification off, CORS with credentials, insecure cookies and randomness, committed secrets, env files not ignored.
2. Start the app once (one process; stop it afterwards — rules/process-lifecycle.md) and run `security_headers <url>` against an HTML page **and** an API endpoint. Set `security.url` in `forge.config.yaml` to a stable local or preview URL so the gate checks it too.
3. `commands.audit` — `stack_use` fills it from the stack pack (`pnpm audit --audit-level high`, `pip-audit`, …). Upgrade or replace vulnerable packages; "not reachable" needs evidence.
4. Stack lens: `stack_info <pack>` → its Review lens has the stack's security items (Next.js server-only imports, Supabase RLS, …).

## 3. Triage every scanner finding
Find the **source** (where the value comes from) and the **sink** (where it is used).
- Reachable from untrusted input → keep the severity and write the exploit scenario: *input → path → sink → impact*.
- Constant, trusted, or already constrained by an allow-list → mark it `false-positive` with the reason **and** add an inline suppression so the gate agrees: `// forge-security-ignore <rule> -- <why it is safe>` (3+ word reason required; suppressions without a reason are ignored).
- Never delete a finding to make the gate pass.

## 4. Manual review — what scanners miss
**Injection** — trace every input to every interpreter:
- SQL: parameters or tagged templates only (`$1`, `?`, `sql` tagged templates, ORM filters). Dynamic identifiers (sort column, table) come from an allow-list.
- NoSQL: request objects are never filters (`{"$ne": null}` login bypass); validate types first (zod/pydantic).
- OS command: no shell; `execFile` / `subprocess.run([...])` with an argument array; allow-listed arguments; watch for option injection (`--upload-pack=…` in git, `-o` in curl) — put `--` before user arguments.
- Code: no dynamic evaluation (`eval`, `new Function`, `vm`, Python `exec`), no dynamic `import()`/`require()` of user paths, no `pickle`/`yaml.load`/`node-serialize` on input.
- Templates (SSTI): user input never becomes template source; auto-escaping stays on.
- Headers / CRLF and logs: strip CR/LF; structured logging; never raw input in `Location`, `Set-Cookie`, `Content-Disposition`.
- Regex: `new RegExp(input)` → ReDoS and pattern injection; escape it, bound input length.
- XML: external entities and DTDs disabled (XXE).
- Prototype pollution (JS): deep merge / `set(obj, path, value)` with user keys — reject `__proto__`, `constructor`, `prototype`; prefer `Map` or `Object.create(null)`.
- Spreadsheet exports: prefix cells starting with `= + - @` (formula injection).
- GraphQL: depth/complexity limits; introspection off in production for private APIs.

**XSS:** frameworks escape text, but not `dangerouslySetInnerHTML` / `v-html`, `href`/`src` with `javascript:` URLs (validate the scheme), `srcdoc`, markdown rendered to HTML (sanitize with DOMPurify), SVG uploads served inline, JSON embedded in `<script>` without escaping `<`.

**Authentication:** passwords hashed with argon2id/bcrypt/scrypt; login, signup and reset rate-limited and not revealing whether an account exists; reset/verification tokens random (≥128 bits), single-use, expiring; sessions rotated on login and privilege change and invalidated on logout/password change; JWTs pin the algorithm and check `exp`, `aud`, `iss`.

**Authorization (the most common real bug):** every handler checks *this user may do this to this object* — IDOR on every id in path, query or body; tenant scoping in every query (RLS for Supabase); admin functions role-checked server-side; mass assignment blocked (explicit input schemas; never `role`, `isAdmin`, `ownerId` from the client).

**CSRF:** cookie-authenticated state changes need SameSite=Lax/Strict **and** a CSRF token or an `Origin`/`Sec-Fetch-Site` check; GET never changes state.

**Security headers** (the live check verifies them): CSP with nonces or hashes (`script-src 'self' 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`), `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY` (legacy browsers), no `X-Powered-By` or version banners. APIs: `default-src 'none'; frame-ancestors 'none'`, `Cache-Control: no-store` on authenticated responses.

**Cookies:** session cookies `HttpOnly; Secure; SameSite=Lax` (or Strict), `__Host-` prefix where possible, nothing sensitive in cookie values.

**CORS:** explicit origin allow-list; never reflect arbitrary origins with credentials; `Vary: Origin`; never the `null` origin.

**SSRF, redirects, files:** outbound URLs allow-listed and resolved IPs checked against private, loopback and link-local ranges (cloud metadata `169.254.169.254`); redirects only to relative paths or allow-listed hosts; file paths resolved and confined to a base directory; uploads size-limited, type-checked by content, given random names, stored outside the web root, served as attachments unless they are images, never executed.

**Secrets & configuration:** no secrets in code, client bundles (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`), logs, error messages or forge memory; debug off in production; error responses without stack traces; `.env` ignored, `.env.example` lists names only.

**Abuse & availability:** body size limits, pagination caps, timeouts on outbound calls, rate limits on expensive and auth endpoints, idempotency keys on payment-like writes.

**Mobile:** tokens in secure storage (Keychain/Keystore, `expo-secure-store`), no secrets in the bundle, deep links validated like any input, WebViews do not run untrusted scripts.

**LLM features:** model output is untrusted input — never execute it, render it as HTML unsanitized, or let it choose URLs, paths or SQL; tools run with the user's permissions only; instructions inside retrieved documents cannot trigger privileged actions without confirmation.

## 5. Severity
- **critical** — unauthenticated code execution, auth bypass, access to all users' data, a committed live credential.
- **high** — one user reaches another user's or tenant's data (IDOR), stored XSS, SQL/command injection behind auth, SSRF to internal services, CORS reflecting origins with credentials, no CSP on an app that renders user content.
- **medium** — reflected XSS needing interaction, missing security headers without a direct exploit, CSRF on low-impact actions, weak cookie flags, verbose errors.
- **low** — hardening and information leaks (version banners, missing Permissions-Policy).

## 6. Write it up and fix it
- Each finding: `severity`, `category: security:<area>`, `file`, `line`, `claim` (what is wrong + CWE), `evidence` (exploit scenario: input → sink → impact, or the scanner snippet), `suggestedFix`.
- The **fixer** first writes a regression test that sends the hostile input — e.g. `' OR 1=1 --`, `; touch /tmp/pwned`, `{"$ne": null}`, `../../etc/passwd`, `http://169.254.169.254/`, `<img src=x onerror=alert(1)>`, `%0d%0aSet-Cookie:x=y` — and fails before the fix. Payloads stay inert and local; never test systems you do not own.
- The **verifier** tries bypasses: encodings, case, double encoding, other parameter locations, other call paths to the same sink.
- Loop until `stage_complete verify` passes. Repeated root causes → `memory_add_learning`; general ones become a line in `rules/secure-by-default.md`.
