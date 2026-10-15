# Secure by default

Applies to every build, verify and ship stage — builders follow it while writing code, reviewers check it.

- **Validate at the boundary.** Every request body, query, param, header, cookie, upload, webhook and LLM output is parsed with a schema (zod / pydantic) before use. Unknown fields are rejected.
- **Never build an interpreter's input from strings.** SQL uses parameters or tagged templates; processes use argument arrays without a shell; no dynamic code evaluation; templates are static files; HTML is escaped by the framework or sanitized with DOMPurify.
- **Authorize every object.** Each handler checks that this user may perform this action on this specific record, scoped to their tenant — on the server, not only in the UI or middleware.
- **Allow-lists for anything that names a place:** redirect targets, outbound URLs (and their resolved IPs), file paths, sort columns, CORS origins.
- **Secure transport and headers:** HTTPS with HSTS, a nonce-based CSP, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`, no `X-Powered-By`. Session cookies `HttpOnly; Secure; SameSite=Lax`.
- **Secrets live in the environment or a secret store** — never in code, client bundles (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`), logs, errors or forge memory.
- **Use the platform's crypto:** `crypto.randomUUID()` / `secrets` for tokens, argon2id/bcrypt for passwords, TLS verification always on.
- **Fail closed:** errors deny access and hide internals (no stack traces to clients).
- A justified exception gets an inline `forge-security-ignore <rule> -- <reason>` and a ledger entry. The verify gate runs `forge security scan` and, when `security.url` is set, `forge security headers`.
