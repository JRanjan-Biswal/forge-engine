# Hono (Node.js) — conventions & review lens

## Conventions
- **Export the app, serve it separately:** `src/app.ts` builds and exports the Hono app; `src/index.ts` only calls `serve()`. Tests import the app and call `app.request()` — no port, no server process.
- **Routes per resource:** `new Hono()` per resource in `src/routes/`, mounted with `app.route("/things", things)`. Chain handlers on one instance so the RPC types (`hc<AppType>`) stay inferred.
- **Validate every input** with `zValidator("json" | "query" | "param", schema)` and read it via `c.req.valid(...)`; the schemas mirror `contracts/openapi.yaml` (or generate the document with `@hono/zod-openapi`).
- **Errors:** one `app.onError` handler mapping known errors to the contract's error shape and status; `HTTPException` for expected failures; `app.notFound` returns the JSON error shape.
- **Middleware order:** `secureHeaders`, `cors` with an explicit origin list, request id/logging, then auth (`jwt`/`bearerAuth` or your session check) on the protected sub-app.
- **Security headers:** `app.use(secureHeaders())` from `hono/secure-headers` (HSTS, nosniff, X-Frame-Options, Referrer-Policy, COOP…); for HTML responses add a CSP with a nonce (`secureHeaders({ contentSecurityPolicy: { scriptSrc: [NONCE] } })`). Check the running service with `forge security headers <url>`.
- **Context typing:** declare `Variables`/`Bindings` generics for `c.set`/`c.get` and env; read env once and validate it.
- **Runtime:** Node via `@hono/node-server`; keep code free of Node-only APIs in shared modules if the service may move to Workers/Bun.
- **Data:** a typed query layer (Drizzle/Kysely/Prisma) with migrations; scope every query to the authenticated owner/tenant.
- **Tests:** Vitest; `app.request(path, init)` for HTTP-level assertions including auth failures.

## Review lens
- [ ] Every body/query/param is validated with zod before use; handlers read `c.req.valid()`, not raw JSON.
- [ ] Auth middleware covers every protected route (mounted on the sub-app, not per handler by memory).
- [ ] Queries are scoped to the caller; no IDOR through path ids.
- [ ] Errors go through `onError` with the contract's shape; no stack traces in responses.
- [ ] CORS lists origins explicitly; `secureHeaders()` on; `forge security headers` passes.
- [ ] No SQL built from template strings, no `exec` with interpolation, no request input in file paths, redirects or outbound URLs without an allow-list.
- [ ] Status codes and response shapes match `contracts/openapi.yaml`.
- [ ] The app is importable without starting a server; tests use `app.request()`.
- [ ] No secret in source; env validated at startup.

## Pitfalls
- Defining routes on separate statements (`app.get(...); app.post(...)`) loses RPC type inference — chain them.
- `c.req.json()` throws on invalid JSON; use the validator so it becomes a 400.
- Middleware registered after a route does not run for that route.
