---
description: forge security review — threat model, static scan (injection, secrets), live header/cookie/CORS check, dependency audit, manual source→sink review
argument-hint: "[scope, branch or URL of the running app]"
---

Security review of: $ARGUMENTS

Use the **security-reviewer** agent following the `security-review` skill:

1. `security_scan` with `record: true` — injection sinks, XSS, traversal, SSRF, redirects, header injection, deserialization, TLS, CORS, cookies, secrets, env files.
2. If a URL was given (or `security.url` is set), `security_headers` on it; otherwise start the app once, check an HTML page and an API endpoint, then stop it.
3. `commands.audit` for vulnerable dependencies.
4. Manual pass: authorization on every object id, tenant scoping, CSRF, sessions, uploads, outbound URLs, LLM output, the stack lens (`stack_info`).
5. Write findings to `reviews` with exploit scenario, CWE and fix; hand them to the **fixer** (regression payload test first) and the **verifier**.

Report blocking findings first. Without MCP, use `forge security scan --record` and `forge security headers <url>`.
