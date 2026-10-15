# Next.js (App Router) — conventions & review lens

## Conventions
- **Read the installed version's docs first:** Next.js ships its guides in `node_modules/next/dist/docs/` (the generated `AGENTS.md` says so). APIs change between majors — check there before writing framework code.
- **Server first.** Components in `src/app` are Server Components by default; add `"use client"` only on the leaf that needs state, effects or browser APIs. Never import server-only modules (DB clients, secrets) into a client component — guard them with `import "server-only"`.
- **Data:** fetch in Server Components or a server-side data layer (`src/server/*`), never from a client component to your own route handler just to read data. Writes go through Server Actions (`"use server"`) or route handlers that follow `contracts/openapi.yaml`.
- **Request APIs are async** (Next 15+): `await params`, `await searchParams`, `await cookies()`, `await headers()`.
- **Every screen state is a route file:** `loading.tsx` (loading), `error.tsx` (error, a client component with a retry), `not-found.tsx`, and an explicit empty state in the page. These map to the forge screen states empty/loading/error/success.
- **Validate at the boundary:** parse every Server Action argument, route-handler body and search param with zod before use; return typed errors, never throw raw strings to the client.
- **Auth checks live next to the data**, in each Server Action / route handler / data function — not only in `proxy.ts` (formerly `middleware.ts`), which is an optimistic redirect layer.
- **Caching is explicit:** decide per route whether data is static, revalidated (`revalidatePath`/`revalidateTag` after writes) or dynamic; do not rely on defaults you have not checked for the installed Next version.
- **Styling:** Tailwind with the forge tokens (`@import` of `design/dist/tailwind.css` in `src/app/globals.css`); no hex/rgb literals in components.
- **Images & fonts:** `next/image` with width/height or `fill` + `sizes`; `next/font` for fonts (no layout shift).
- **Env:** only `NEXT_PUBLIC_*` reaches the browser — never put secrets behind that prefix. Read env in one module and validate it at startup.
- **Security headers** in `next.config.ts` `headers()` for every route: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`; set `poweredByHeader: false`. The CSP is nonce-based and set in `proxy.ts` (generate a nonce per request, set it on the request and response `Content-Security-Policy`, `script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`). Nonces need per-request rendering: `await connection()` in the page, and with Cache Components (`cacheComponents: true`, the default in new apps) also `export const instant = false` on that page or layout — otherwise the build fails or the prerendered shell's scripts lack the nonce. Verify on the running app that every `<script>` carries the response's nonce, and run `forge security headers <url>`.
- **Tests:** Vitest + Testing Library for client components and pure logic (async Server Components are covered by Playwright), Playwright for story-level flows.

## Review lens
- [ ] `"use client"` is on the smallest possible component; no server-only import leaks into a client bundle.
- [ ] No secret or service key referenced from a client component or a `NEXT_PUBLIC_*` variable.
- [ ] Every Server Action and route handler validates input, checks authorization itself and returns the contract's error shape.
- [ ] `params` / `searchParams` / `cookies()` / `headers()` are awaited.
- [ ] Each screen has loading, error, empty and success states (route files or explicit UI) and they are reachable in tests.
- [ ] Mutations revalidate or redirect so the UI cannot show stale data.
- [ ] No hard-coded colours, spacing or fonts — tokens only; images use `next/image` with dimensions.
- [ ] Security headers and a nonce-based CSP are set; `poweredByHeader: false`; `forge security headers` passes against the running app.
- [ ] No `dangerouslySetInnerHTML` without DOMPurify; redirects only to relative paths or allow-listed hosts.
- [ ] No `fetch` to the app's own route handlers from Server Components.
- [ ] No placeholder/mock data in product code (rules/no-fake-data.md).
- [ ] Accessibility: semantic elements, labels on inputs, focus visible, keyboard paths in Playwright specs.

## Pitfalls
- Vercel preview deployments are usually behind Vercel Authentication: an unauthenticated request gets a 302 to `vercel.com/sso-api`. Smoke and e2e checks must not follow it (forge doesn't); set `VERCEL_AUTOMATION_BYPASS_SECRET` (`vercel project protection enable <project> --protection-bypass`) so checks send `x-vercel-protection-bypass`.
- A `"use client"` at the top of a layout turns the whole subtree into client code.
- `redirect()` inside `try/catch` is swallowed — call it outside the try.
- `cookies().set()` only works in Server Actions and route handlers, not while rendering.
- Edge runtime cannot use Node APIs (fs, most DB drivers); keep the Node runtime unless there is a reason.
