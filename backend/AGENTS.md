# Backend

FastAPI serving the JSON API under `/api` and the NextJS static export at `/`. Managed with uv, Python 3.14.

## Layout

```
backend/
  pyproject.toml   uv project; [tool.uv] package = false, so pytest needs pythonpath = ["."]
  uv.lock          committed for reproducible builds
  app/
    main.py        app factory, lifespan schema init, router order, static mount
    config.py      env-backed settings and the persisted signing key
    db.py          sqlite connection, schema, password hashing, board read/write
    auth.py        login, logout, me, and the current_user dependency
    board.py       GET and PUT /api/board
    schemas.py     pydantic models, including BoardData integrity validation
    seed.py        starting board for a new user; frontend initialData mirrors this
  static/          dev-only placeholder; the container serves the NextJS export here
  tests/
```

## Route order matters

`main.py` registers routers in this order, and it must stay this way:

1. `health_router`
2. `auth.router`
3. `board.router`
4. `fallback_router` - claims every remaining `/api/{path}` so unmatched API calls return a JSON 404 instead of falling through to the static site
5. `StaticFiles` mounted at `/`

Any new API router goes before `fallback_router`.

## Auth

Sessions are a signed cookie, not a server-side store, so they survive a restart with no session table.

- Cookie `session`, HttpOnly, `SameSite=Lax`, 7 day max age
- Signed with `itsdangerous.URLSafeTimedSerializer`, salt `pm-session`
- `current_user` is a dependency returning the username or raising 401. Depend on it from any route that needs a signed-in user
- Passwords use `hashlib.pbkdf2_hmac` with SHA-256, 200k rounds and a per-user hex salt, stored as `salt$hash`. Standard library only, no bcrypt or passlib dependency

`config.secret_key()` returns `SECRET_KEY` if set, otherwise generates one and writes it to `secret_key` beside the database. Both live on the Docker volume, so sessions and data persist together.

## Board storage

The whole board is one JSON document in `boards.data`, one row per user. See `docs/DATABASE.md` for the schema and the reasoning.

- `GET /api/board` returns the signed-in user's board
- `PUT /api/board` replaces it wholesale and bumps `updated_at`

`db._ensure_board` seeds a board on first access rather than only at startup, so any user gets one, not just the seeded default. `init_db` calls it too, which keeps the documented first-run behaviour.

Validation lives in the `BoardData` model validator in `schemas.py`, not in the route. That means the integrity rules apply anywhere the model is constructed, including AI output in Part 9, and a violation is a 422 with no extra route code. When changing the board shape, update `schemas.py`, `frontend/src/lib/kanban.ts`, `app/seed.py`, and `docs/DATABASE.md` together.

## Config

Read from the environment, with defaults suitable for local dev:

| Variable | Default |
|---|---|
| `DB_PATH` | `backend/data/pm.db`, `/data/pm.db` in Docker |
| `STATIC_DIR` | `backend/static`, `/app/static` in Docker |
| `SECRET_KEY` | generated and persisted next to the database |
| `OPENROUTER_API_KEY` | empty |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3.5-lightning:free` |

`config.py` exposes these as module attributes read at call time, not captured at import, which is what lets tests monkeypatch them.

## Tests

Run with `scripts/test-backend.ps1` or `scripts/test-backend.sh`, which execute pytest in a uv container so no local Python is needed.

The `client` fixture in `tests/conftest.py` points `DB_PATH` at a `tmp_path` and enters the `TestClient` context so the lifespan runs, giving every test a freshly seeded database. Use it rather than constructing `TestClient` directly, or tests will share the real database and the schema will not exist.

## Gotchas

- `httpx2`, not `httpx`. Starlette 1.6 deprecated `httpx` for its TestClient. It imports as `httpx2` and exposes `AsyncClient`.
- `StaticFiles` needs its directory to exist at import time, which is why `backend/static/` is kept in git even though Docker overwrites it.
- Static export means no server-side routing, so a deep link to anything other than `/` returns the exported `404.html`.
