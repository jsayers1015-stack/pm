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
    ai.py          OpenRouter chat completions client
    chat.py        POST /api/chat, the tool definition and system prompt
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
4. `chat.router`
5. `fallback_router` - claims every remaining `/api/{path}` so unmatched API calls return a JSON 404 instead of falling through to the static site
6. `StaticFiles` mounted at `/`

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

## AI

`ai.chat_completion(messages, tools=None, tool_choice=None)` posts to OpenRouter and returns the first choice's raw message dict, so a caller forcing a tool call can read `tool_calls` off it.

Everything that can go wrong raises `ai.AIError` with a readable message: no key, a rejected key, a 429, any other non-200, a transport failure, and a 200 carrying an error body with no `choices`. Nothing in `ai.py` maps to an HTTP status; the chat route does that.

Verified live against `nvidia/nemotron-3.5-lightning:free`: it supports `tools` and `tool_choice` including forcing a named function, but not `response_format` or `structured_outputs`. That is why the chat route gets structured output through a forced tool call.

## Chat

`POST /api/chat` takes `{message, history}` and returns `{reply, board_updated}`. History is held in frontend state and sent with every turn, so there is no messages table.

Structure comes from one tool, `respond_to_user`, with `tool_choice` pinned to it so every reply is a tool call. It takes a required `reply` and an optional `board`. The model is told to omit `board` unless the user asked for a change.

The `board` parameter's JSON schema is generated from `BoardData.model_json_schema()` rather than hand-written, so the tool cannot drift from the validator. Its `$defs` are hoisted to the root of `parameters` because the generated `$ref`s are absolute to the top of whatever schema document they are sent in.

Anything the model returns as a board goes through `BoardData` before it is stored, so the Part 6 integrity rules apply to AI output for free. A board that fails validation is dropped: the user still gets the reply, `board_updated` is false, and the stored board is untouched. A malformed or absent tool call falls back to plain message content. Only a reply with no usable content at all is an error, and `AIError` becomes a 502.

Expect this to be slow. A measured add-a-card call took 92 seconds, because the whole-board-replacement design makes the model reproduce all eight cards to add one. A question that returns no board takes about 6 seconds. `ai.TIMEOUT` is 180 seconds to cover it.

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

`asyncio_mode = "auto"` means async tests need no decorator. Tests marked `live` call the real API and are deselected by the `-m 'not live'` default in `pyproject.toml`, so the default suite needs no network and no key. Run them with `scripts/test-ai.ps1` or `scripts/test-ai.sh`, which are the only scripts that pass `.env` into the container.

The `openrouter` fixture fakes the network by monkeypatching `ai.AsyncClient` with one built on an `httpx2.MockTransport`, which also captures the outgoing request for assertions. That works because `ai.py` constructs its client per call. Combine it with `signed_in` to test the chat route end to end without leaving the process.

## Gotchas

- `httpx2`, not `httpx`. Starlette 1.6 deprecated `httpx` for its TestClient. It imports as `httpx2` and exposes `AsyncClient`.
- `StaticFiles` needs its directory to exist at import time, which is why `backend/static/` is kept in git even though Docker overwrites it.
- Static export means no server-side routing, so a deep link to anything other than `/` returns the exported `404.html`.
