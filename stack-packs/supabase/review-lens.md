# Supabase — conventions & review lens

## Conventions
- **Schema only through migrations:** `supabase migration new <name>`, write SQL, apply with `supabase db reset` locally; never change the remote schema in the dashboard. Migrations are append-only once merged.
- **RLS on every table in an exposed schema** (`alter table … enable row level security`) in the same migration that creates it, with explicit policies per operation (`select`/`insert`/`update`/`delete`) and role (`authenticated`, `anon`). Use `(select auth.uid())` in policies so it is evaluated once per statement.
- **Index what policies filter on** (e.g. `user_id`, `org_id`), and foreign keys.
- **Keys:** the publishable (anon) key is public and safe only because of RLS; the secret/service-role key bypasses RLS and lives only on the server (edge functions, backend) — never in a client bundle, `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.
- **Types:** regenerate `supabase gen types typescript --local > src/types/database.ts` after every migration and use them in the client (`createClient<Database>`).
- **Server rendering:** in Next.js use `@supabase/ssr` (cookie-based sessions); verify the user server-side with `auth.getUser()` (or verified claims), not a client-provided session object.
- **Functions:** `security definer` functions set `search_path = ''` and check the caller themselves; prefer `security invoker`.
- **Storage:** buckets private by default with policies on `storage.objects`; signed URLs for private files.
- **Seed:** `supabase/seed.sql` is local development data only and must never run against production.
- **Tests:** pgTAP in `supabase/tests/` — for each policy, assert allowed and denied cases as anon, the owner and another user.

## Review lens
- [ ] Every new table enables RLS in the same migration and has policies for each operation it allows.
- [ ] Policies use `(select auth.uid())`, check ownership/tenancy, and have supporting indexes.
- [ ] No service-role/secret key in client code or public env vars.
- [ ] `security definer` functions pin `search_path` and authorize the caller.
- [ ] Migration is reversible or safe to roll forward; no destructive change without a data plan.
- [ ] Generated types updated with the migration.
- [ ] pgTAP tests cover allowed and denied access for each policy.
- [ ] Storage buckets are private unless public by design; object policies scoped to owner.

## Pitfalls
- A table created without RLS in `public` is readable and writable by anyone holding the publishable key.
- `auth.uid()` is null for anon requests — policies comparing it must not accidentally match null rows.
- Views bypass RLS unless created with `security_invoker = true`.
