# Rubric — security review

Binary checks for a security review's quality. Pass = all of 1–6 and at least 3 of 7–10.

1. A threat model lists assets, entry points and trust boundaries?
2. `security_scan` ran on the final code and nothing at `security.failOn` or above is open or suppressed without a reason?
3. Every scanner finding is triaged (fixed, or false-positive with a written reason and an inline suppression)?
4. Every endpoint that takes an object id was checked for authorization on that object (IDOR) and tenant scoping?
5. Every fixed injection/XSS/SSRF/traversal finding has a regression test that sends the hostile input?
6. No secret in code, client bundles, logs, error messages or forge memory?
7. The running app's headers, cookies and CORS were checked with `security_headers` (HTML page and API)?
8. `commands.audit` ran and high/critical advisories are fixed or justified?
9. Authentication flows (login, reset, session rotation, logout) were reviewed?
10. LLM features (if any) treat model output as untrusted?
