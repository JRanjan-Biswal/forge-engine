# FastAPI — conventions & review lens

## Conventions
- **Contract first:** routes, models and status codes follow `contracts/openapi.yaml`. Compare the generated document (`/openapi.json`) with the contract in a test; drift fails the build.
- **One `APIRouter` per resource** in `app/routers/`, mounted in `app/main.py` with a prefix and tags. Use `Annotated[..., Depends(...)]` for injected values (DB session, current user, settings).
- **Models:** pydantic v2 request/response models separate from ORM models; set `response_model` (or a return annotation) on every route so internal fields never leak. `model_config = ConfigDict(extra="forbid")` on request bodies.
- **Errors:** raise `HTTPException` (or a custom exception + handler) with the contract's error shape; never return 200 with an error body. Validation errors stay 422 unless the contract says otherwise.
- **Async correctly:** `async def` routes only call async I/O (async DB driver, `httpx.AsyncClient`); blocking libraries go in plain `def` routes (run in the threadpool) or `run_in_threadpool`.
- **Settings & secrets:** `pydantic-settings` reads env vars once; secrets never in code or the repo. Startup/shutdown resources via the `lifespan` context manager.
- **Data:** SQLAlchemy 2.0 (async) or SQLModel with Alembic migrations; one session per request through a dependency; queries filtered by the caller's tenant/owner.
- **Auth:** OAuth2/JWT via `fastapi.security`; check authorization in a dependency that every protected router declares, not inside handlers ad hoc.
- **Tests:** pytest + `TestClient` (or `httpx.AsyncClient` with `ASGITransport`); override dependencies with `app.dependency_overrides` to use a real test database, not mocks of your own code.
- **Run:** `fastapi dev app/main.py` locally; `fastapi run` in production behind a process manager.

## Review lens
- [ ] Every route has a response model; no ORM object or password hash can leak.
- [ ] Request bodies forbid extra fields and validate ranges/lengths; IDs in paths are typed.
- [ ] Authorization is enforced by a dependency, and queries are scoped to the caller (no IDOR).
- [ ] No blocking call inside `async def` (requests, time.sleep, sync DB drivers).
- [ ] Errors use the contract's shape and status codes; no bare `except:` swallowing errors.
- [ ] Writes that can be retried accept an idempotency key where the contract says so.
- [ ] Secrets come from settings/env; CORS origins are explicit (no `*` with credentials).
- [ ] Tests cover success, validation error, unauthorized and not-found per endpoint.
- [ ] Generated OpenAPI matches `contracts/openapi.yaml`.

## Pitfalls
- A mutable default in a pydantic model or `Depends` provider is shared across requests.
- `BackgroundTasks` run in the same process after the response — not a job queue.
- Returning a dict from a route skips nothing: without `response_model` every key goes out.
