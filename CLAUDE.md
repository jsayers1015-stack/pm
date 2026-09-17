# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project Management MVP: a Kanban board with an AI chat sidebar that can create/edit/move cards. FastAPI serves the JSON API and also serves the static NextJS export from the same container. Single hardcoded user (`user` / `password`) for the MVP; the database supports multiple users for the future.

Detailed, currently-accurate docs live alongside the code — read them before working in that area, they contain a lot that should not be duplicated here:

- [AGENTS.md](AGENTS.md) — business requirements, technical decisions, color scheme, coding standards
- [backend/AGENTS.md](backend/AGENTS.md) — route order, auth, board storage, AI/chat implementation, config, test fixtures, gotchas
- [frontend/AGENTS.md](frontend/AGENTS.md) — data model, session flow, chat state, persistence/debounce logic, styling, test hooks, build modes
- [docs/DATABASE.md](docs/DATABASE.md) — SQLite schema, the single-JSON-document board design, integrity rules, migration path

## Commands

Run everything from the project root unless noted.

### Run the app (Docker)

```powershell
.\scripts\start.ps1   # build and start; open http://localhost:8000
.\scripts\stop.ps1    # stop; add --volumes to also delete the database
```

Requires an `.env` in the project root with `OPENROUTER_API_KEY`.

### Local development (hot reload, no Docker)

Requires Node and [uv](https://docs.astral.sh/uv/getting-started/installation/) installed locally. Backend on :8000, frontend on :3000.

```powershell
.\scripts\dev.ps1
```

### Backend tests

Run in a uv container, no local Python needed:

```powershell
.\scripts\test-backend.ps1
```

Equivalent to `pytest` with `-m 'not live'` (the default in `pyproject.toml`). To run a single test file/case, that flag still applies:

```powershell
docker run --rm -v ${PWD}/backend:/app -w /app ghcr.io/astral-sh/uv:python3.14-bookworm uv run pytest tests/test_chat.py::test_name
```

Live OpenRouter tests (marked `live`, real network call, needs the API key):

```powershell
.\scripts\test-ai.ps1
```

### Frontend tests

```bash
cd frontend
npm install
npx playwright install chromium
npm run typecheck        # tsc --noEmit; vitest does not type-check
npm run test:unit        # vitest
npm run test:e2e         # playwright — requires the app already running (container on :8000)
npm run test:all
npm run lint
```

The live chat e2e is tagged `@live`, skipped unless `LIVE_AI=1` (quote the `@` on Windows):

```powershell
$env:LIVE_AI=1; npm run test:e2e -- --grep '@live'
```

e2e runs with `workers: 1` — there is one board for one user, so parallel tests would clobber each other.

## Architecture

**Backend** (`backend/app/`): FastAPI app. Routers are registered in `main.py` in a fixed order — `health`, `auth`, `board`, `chat`, then a catch-all `fallback_router` that claims remaining `/api/{path}` (so unmatched API calls 404 as JSON, not HTML), then `StaticFiles` mounted at `/`. Any new API router must go before `fallback_router`.

- Auth is a signed cookie (`itsdangerous`), not a server-side session store — no session table needed. Passwords hashed with stdlib PBKDF2-SHA256.
- The entire Kanban board is stored as **one JSON document per user** (`boards.data` in SQLite), not normalized tables — the frontend and the AI both replace the whole board wholesale, so normalization would buy nothing. See `docs/DATABASE.md` for the full rationale and integrity rules.
- Board shape validation (`BoardData` in `schemas.py`) lives in the pydantic model, not the route, so it applies uniformly to client `PUT`s and AI-generated boards. Changing the board shape means updating `schemas.py`, `frontend/src/lib/kanban.ts`, `app/seed.py`, and `docs/DATABASE.md` together.
- AI chat (`ai.py`, `chat.py`) calls OpenRouter (`nvidia/nemotron-3.5-lightning:free`) and forces a single tool call (`respond_to_user`) to get structured output, since the model doesn't support `response_format`. The tool's `board` parameter schema is generated from `BoardData.model_json_schema()` so it can't drift from the validator. A board that fails validation is dropped silently (reply still returned, `board_updated: false`); only a totally empty AI response is a hard error (502). The AI board is saved conditionally on the `updated_at` read before the call, so it never overwrites an edit the user made while the model was working.
- Board-changing AI calls are slow (~90s, since it rewrites the whole board to add one card); question-only replies are ~6s. Client timeout and UI copy account for this.

**Frontend** (`frontend/src/`): NextJS App Router, single route. `AppShell` is the only real entry point (session gate: loading → `LoginForm` or `KanbanBoard`), since the static export has no middleware/routing. `lib/api.ts` always uses relative `/api` paths with `credentials: "include"`.

- Board data model is normalized client-side: `columns` hold ordered `cardIds`, `cards` is a flat lookup by id — mirrors `BoardData` in `backend/app/schemas.py` exactly.
- `KanbanBoard` owns board state; every mutation goes through `mutate(updater)`, which updates state immediately and debounces a `PUT /api/board` by 300ms so rapid changes (e.g. per-keystroke renames) coalesce into one request. Do not replace this debounce with a save-per-handler — an e2e test asserts exactly one `PUT` for a multi-keystroke rename.
- `next.config.ts` branches on `BUILD_STATIC`: unset runs `next dev` with an `/api/*` rewrite to the backend (same-origin, so cookies work without CORS); `BUILD_STATIC=1` produces the static `out/` export the Dockerfile bakes into the image.

## Coding standards (from AGENTS.md)

1. Use current, idiomatic library versions.
2. Keep it simple — no over-engineering, no unnecessary defensive programming, no speculative features.
3. Be concise; no emojis, ever.
4. When something breaks, find the root cause with evidence before fixing — don't guess.
