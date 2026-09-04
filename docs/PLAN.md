# Project Plan

Build order for the Project Management MVP. Each part has substeps to check off, tests, and success criteria. Do not start a part until the previous part's success criteria are met.

## Agreed decisions

These were settled before work began and apply throughout.

| Decision | Choice |
|---|---|
| Board storage | SQLite, whole board as a JSON blob in one column, keyed by user |
| Auth | Backend-issued HTTP-only signed cookie, validated on every API call |
| Dev workflow | Docker for the real thing, plus a local dev mode with hot reload |
| AI board updates | AI returns the complete replacement board, not incremental operations |
| AI mechanism | Forced tool calling, because `nvidia/nemotron-3.5-lightning:free` does not support `response_format` or `structured_outputs` |
| Card editing | Added in Part 3 |
| Serving | One FastAPI process on port 8000 serves both `/api/*` and the static site at `/` |

## Architecture

```
Browser
  |
  v
FastAPI (port 8000)
  |-- /api/*            JSON API, session cookie required except /api/login
  |-- /                 static NextJS export (mounted last, catches everything else)
  |
  |-- SQLite at $DB_PATH (volume-mounted so it survives container restarts)
  |-- OpenRouter (chat completions with forced tool call)
```

Planned backend layout, kept deliberately flat:

```
backend/
  pyproject.toml     uv-managed
  app/
    main.py          app factory, route registration, static mount
    config.py        env-backed settings
    db.py            connection, schema init, board read/write
    auth.py          login, logout, cookie signing, current-user dependency
    board.py         board routes
    chat.py          chat route
    ai.py            OpenRouter client
    schemas.py       pydantic models
    seed.py          starting board for a new user
  tests/
```

### API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Body `{username, password}`. Sets session cookie. |
| POST | `/api/logout` | Clears cookie. |
| GET | `/api/me` | Returns `{username}`, or 401 if not signed in. |
| GET | `/api/board` | Returns the signed-in user's `BoardData`. |
| PUT | `/api/board` | Replaces the board with the posted `BoardData`. |
| POST | `/api/chat` | Body `{message, history}`. Returns `{reply, board_updated}`. |
| GET | `/api/health` | Liveness check, no auth. |

Conversation history is held in frontend state and sent with each chat request, so no messages table is needed.

---

## Part 1: Plan

- [x] Read `AGENTS.md`, `docs/PLAN.md`, and the existing frontend
- [x] Resolve open questions with the user and record the decisions above
- [x] Confirm `OPENROUTER_API_KEY` is present and parseable in `.env`
- [x] Verify the chosen model's capabilities against the OpenRouter model API
- [x] Write `frontend/AGENTS.md` describing the existing frontend
- [x] Enrich this document with substeps, tests, and success criteria
- [x] User reviews and approves this plan

**Tests:** none, this part is documentation only.

**Success criteria:** the user has explicitly approved this plan and `frontend/AGENTS.md` accurately describes the existing code.

---

## Part 2: Scaffolding

Docker infrastructure, FastAPI backend, and start/stop scripts. Serves a placeholder static page plus one working API call. No Kanban yet.

- [x] Confirm the baseline first: run `npm install` and `npm run test:all` in `frontend/` and record that it passes, so later failures are attributable. Baseline was 6 unit and 3 e2e tests, all green
- [x] Create `backend/pyproject.toml` for uv with `fastapi`, `uvicorn[standard]`, `itsdangerous`, `httpx2`, and dev extras `pytest`, `pytest-asyncio`
- [x] Write `backend/app/config.py` reading `DB_PATH`, `SECRET_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` from the environment
- [x] Write `backend/app/main.py` with `GET /api/health` returning `{"status": "ok"}`
- [x] Serve a placeholder `static/index.html` that fetches `/api/health` and renders the result, proving same-origin API access works
- [x] Mount static files at `/` with `html=True`, registered after all API routes
- [x] Commit a `uv.lock` for reproducible builds, generated in a container since uv is not installed on the host
- [x] Write the `Dockerfile` python stage using uv. The node stage is deferred to Part 3, because there is no static export to build until `output: "export"` is configured
- [x] Write `docker-compose.yml` exposing port 8000, mounting a named volume at `/data`, and passing `.env` through
- [x] Write `.dockerignore` excluding `node_modules`, `.next`, `out`, `__pycache__`, `.venv`
- [x] Write `scripts/start.sh`, `scripts/stop.sh` (Mac and Linux) and `scripts/start.ps1`, `scripts/stop.ps1` (Windows), wrapping compose up/down
- [x] Write `scripts/dev.sh` and `scripts/dev.ps1` running uvicorn with reload alongside `next dev`
- [x] Add `scripts/test-backend.sh` and `scripts/test-backend.ps1` running pytest in a container, so backend tests need no local Python
- [x] Add `.gitattributes` forcing LF on `*.sh`, and convert the shell scripts, which were written as CRLF and would have failed on Mac and Linux
- [x] Add `backend/tests/test_health.py`
- [x] Write a minimal root `README.md` covering run, stop, and test

**Tests**

- [x] Backend unit: `GET /api/health` returns 200 and `{"status": "ok"}`
- [x] Backend unit: an unknown `/api/*` path returns 404 rather than the static index
- [x] Backend unit: `/` serves the static index
- [x] Manual: `scripts/start.ps1`, then `http://localhost:8000` shows the placeholder page with the health result rendered

**Success criteria**

- [x] `docker compose up --build` succeeds from a clean state
- [x] `http://localhost:8000/` serves the placeholder and its client-side call to `/api/health` succeeds, verified in a real browser with no console errors or failed requests
- [x] `http://localhost:8000/api/health` returns 200
- [x] Start and stop scripts work on this machine and exit 0; the `.sh` scripts pass `bash -n` in a Linux container
- [x] `pytest` passes in `backend/`, 3 of 3
- [x] The final image contains no Node or npm

---

## Part 3: Add in Frontend

Replace the placeholder with the real statically exported Kanban board. Add card editing. Still no backend persistence.

- [x] Make `next.config.ts` conditional: `output: "export"` plus `images: { unoptimized: true }` when `BUILD_STATIC=1`, otherwise a rewrite proxying `/api/*` to `127.0.0.1:8000` so dev mode is same-origin and needs no CORS
- [x] Add the Dockerfile node stage running `BUILD_STATIC=1 npm run build`, and copy `out/` into the python stage, replacing the Part 2 placeholder
- [x] Point the FastAPI static mount at the exported directory
- [x] Implement card editing: an Edit button opens an inline form for title and details, with Save and Discard
- [x] Add an `onEditCard(cardId, title, details)` handler in `KanbanBoard` threaded through `KanbanColumn` to `KanbanCard`. No `columnId` parameter, because `cards` is a flat record keyed by id
- [x] Keep the drag listeners and the edit affordance from fighting: editing passes `disabled: isEditing` to `useSortable` and stops spreading the listeners
- [x] Keep `backend/static/index.html` as a dev-mode placeholder, since the mount needs a directory to exist when running outside Docker
- [x] Move the card actions to a row beneath the text, because a vertical Edit/Remove stack squeezed the title and details in the narrow columns
- [x] Remove the redundant `cardsById` memo in `KanbanBoard`
- [x] Repoint `playwright.config.ts` at the served app on port 8000, removing the `next dev` webServer. `BASE_URL` overrides it
- [x] Extend unit tests to cover editing
- [x] Extend e2e tests to cover editing against the built container

**Tests**

- [x] Unit: editing a card's title and details updates the rendered card
- [x] Unit: discarding an edit leaves the card unchanged
- [x] Unit: an empty title does not save and the form stays open
- [x] Unit: existing column rename, add, delete, and `moveCard` tests still pass
- [x] e2e: board loads at `/` with five columns
- [x] e2e: add, edit, discard an edit, and drag a card
- [x] e2e: dragging a card still works after an edit, guarding against broken dnd listeners

**Success criteria**

- [x] The real Kanban board renders at `http://localhost:8000/` from the container
- [x] No console errors, page errors, or failed network requests on load
- [x] Cards can be edited in the UI
- [x] Unit tests pass, 9 of 9. e2e tests pass, 6 of 6. Backend tests pass, 3 of 3
- [x] The final image contains no Node runtime

---

## Part 4: Fake user sign in

- [x] Add a `users` table and seed `user` with a hashed password on first run. PBKDF2-SHA256, 200k rounds, per-user salt, all from the standard library so there is no extra dependency
- [x] Implement `POST /api/login` verifying credentials and setting an HTTP-only, `SameSite=Lax` signed cookie via `itsdangerous`
- [x] Implement `POST /api/logout` clearing the cookie
- [x] Implement `GET /api/me`
- [x] Add a `current_user` FastAPI dependency returning 401 on a missing or invalid cookie
- [x] Generate `SECRET_KEY` if absent and persist it next to the database, so sessions survive a restart
- [x] Create the schema on startup via a FastAPI lifespan, which also gives tests a clean database per test
- [x] Build a login page component matching the palette, with the submit button in secondary purple
- [x] Gate the board client-side on `GET /api/me` in a new `AppShell`, showing login when it returns 401
- [x] Add a sign out control to the board header, showing the signed-in username
- [x] Ensure the static export still has a single entry point, since client-side gating means no separate route is needed

**Tests**

- [x] Backend: login with correct credentials returns 200 and sets the cookie
- [x] Backend: the cookie is HttpOnly and SameSite=Lax
- [x] Backend: login with a wrong password, and with an unknown user, both return 401 and set no cookie
- [x] Backend: a malformed login body returns 422
- [x] Backend: a protected route without a cookie returns 401
- [x] Backend: a protected route with a tampered cookie returns 401
- [x] Backend: a cookie signed with a different key returns 401
- [x] Backend: logout clears the cookie and the protected route then returns 401
- [x] Backend: the password is not stored in plain text and verifies correctly
- [x] Backend: schema init is idempotent and does not duplicate the seeded user
- [x] Backend: the secret key is generated once and reused on the next call
- [x] Unit: login form renders, submits, and surfaces a rejection without leaving the form
- [x] Unit: the gate shows login on 401, the board on success, and falls back to login if the session check throws
- [x] Unit: the board shows the signed-in username and calls back on sign out
- [x] e2e: visiting `/` shows login; wrong credentials show an error; `user`/`password` reveals the board; sign out returns to login; reloading after login keeps the session; reloading after sign out stays signed out
- [x] e2e: `/api/me` returns 401 to a direct request, proving the API and not just the UI is protected

**Success criteria**

- [x] The board is unreachable without signing in, both in the UI and at the API level
- [x] Sessions survive a container restart, verified by reusing a cookie across `docker compose restart`
- [x] All tests pass: 16 backend, 16 frontend unit, 13 e2e
- [x] No console errors while signed in. The one console message when signed out is the browser logging the expected 401 from the session probe

---

## Part 5: Database modeling

- [x] Write `docs/DATABASE.md` documenting the JSON-blob-in-SQLite approach and why it was chosen over normalized tables
- [x] Specify the `users` and `boards` tables with column types and constraints
- [x] Document the `BoardData` JSON contract and confirm it matches `frontend/src/lib/kanban.ts` exactly
- [x] Spell out the integrity rules Part 6 must validate on write, since pydantic cannot check cross-references
- [x] Document schema creation on first run and the seeding of the default user and default board
- [x] Note the migration path to normalized tables if the app outgrows the MVP
- [x] User signs off on `docs/DATABASE.md`

The schema, the JSON contract, and the integrity rules all live in `docs/DATABASE.md` rather than being duplicated here, so there is one place to keep correct.

**Tests:** none, this part is documentation only.

**Success criteria**

- [x] `docs/DATABASE.md` exists
- [x] The JSON contract matches the frontend types field for field, verified against `frontend/src/lib/kanban.ts`
- [x] The user has signed off

---

## Part 6: Backend API

- [x] Implement `db.py`: connect, create schema if absent, seed default user and board
- [x] Store the default board in `app/seed.py` as the same seed data the frontend hardcodes, so behaviour is unchanged
- [x] Define pydantic models `Card`, `Column`, `BoardData` mirroring the frontend types
- [x] Implement `GET /api/board` scoped to the signed-in user
- [x] Implement `PUT /api/board` validating the payload and writing it with a fresh `updated_at`
- [x] Enforce every integrity rule in `docs/DATABASE.md` in a `BoardData` model validator, so violations return 422 automatically and the same rules apply to AI output in Part 9
- [x] Seed a board lazily on first access, so any user gets one and not just the seeded default
- [x] Have `current_user` reject a validly signed cookie naming a user who no longer exists, which would otherwise 500 in the board queries
- [x] Confirm the SQLite file is created at `DB_PATH` on the volume if missing

**Tests**

- [x] Backend: a fresh database is created when the file does not exist
- [x] Backend: schema init is idempotent across repeated startups
- [x] Backend: `GET /api/board` returns the seeded board with five columns and eight cards
- [x] Backend: the seeded board equals `app/seed.py` exactly
- [x] Backend: `PUT /api/board` then `GET /api/board` round-trips identical data
- [x] Backend: `PUT` bumps `updated_at`
- [x] Backend: `PUT` with a malformed body, a wrong field type, or a missing card field returns 422
- [x] Backend: `PUT` with a dangling card id returns 422
- [x] Backend: `PUT` with the same card in two columns returns 422
- [x] Backend: `PUT` with a card in `cards` that no column lists returns 422
- [x] Backend: `PUT` with a `cards` key that disagrees with the card's own `id` returns 422
- [x] Backend: `PUT` with duplicate column ids returns 422
- [x] Backend: a rejected `PUT` leaves the previously stored board byte-identical
- [x] Backend: both board routes return 401 without a session
- [x] Backend: two different users get separate boards, proving the multi-user path works

**Success criteria**

- [x] Board state persists across a container restart, verified end to end through the API
- [x] Every test above passes: 34 backend, 16 frontend unit, 13 e2e
- [x] Deleting the SQLite file and restarting yields a working seeded board, verified with `stop.ps1 --volumes`
- [x] Adding `boards` to a pre-existing Part 4 database works without losing the existing user

---

## Part 7: Frontend plus Backend

- [x] Add a small `src/lib/api.ts` wrapping fetch with `credentials: "include"` and relative `/api` paths
- [x] Load the board from `GET /api/board` on mount instead of `initialData`
- [x] Show a loading state while the board is in flight
- [x] Persist every mutation through `PUT /api/board`
- [x] Debounce column rename saves, since the handler fires on every keystroke
- [x] Keep the UI optimistic: apply local state immediately, then save
- [x] Surface a non-blocking error if a save fails, and refetch to resync
- [x] Keep `initialData` only as backend seed data and test fixtures, not as live frontend state
- [x] Handle a 401 mid-session by returning the user to login
- [x] Make the e2e suite isolated again now that changes persist: `workers: 1` in `playwright.config.ts` because there is one board for one user, a `signInWithFreshBoard` helper resetting the board before each test, and a `waitForBoardSave` helper so a test does not reload before the debounced write lands

Every mutation goes through one `mutate()` helper that applies the change locally
and flags a pending save. A single effect watching `board` schedules the `PUT`
after 300ms and cancels the previous timer whenever `board` changes again, so one
code path covers both "save each mutation" and "debounce the rename". Loads and
error resyncs call `setBoard` directly, so they never trigger a save of data that
just came from the server.

`initialData` stayed in `src/lib/kanban.ts` but is now test-only: unit tests mock
`getBoard()` with it, and the e2e `signInWithFreshBoard` helper PUTs it to reset
the board between tests. It must stay in sync with `backend/app/seed.py`.

**Tests**

- [x] Unit: board renders from a mocked `GET /api/board`
- [x] Unit: loading state shows before the fetch resolves
- [x] Unit: each mutation triggers a `PUT` with the expected body
- [x] Unit: rename is debounced into a single `PUT`
- [x] Unit: a failed `PUT` surfaces an error and refetches
- [x] Unit: a 401 returns the user to login, on both load and save
- [x] e2e: add a card, reload the page, the card is still there
- [x] e2e: remove a card, reload, it stays gone
- [x] e2e: drag a card, reload, the new position persists
- [x] e2e: edit a card, reload, the edit persists
- [x] e2e: rename a column, reload, the name persists
- [x] e2e: a discarded edit is never saved
- [x] e2e: sign out and back in, changes are still present
- [x] Restart the container, sign in again, all changes are still present. Done as a manual check rather than a suite test, since restarting Docker mid-run would make the suite slow and dependent on the host

**Success criteria**

- [x] The board is fully persistent across reloads and restarts. Verified by recreating the container with `stop.ps1` then `start.ps1`; a renamed column, an edited card and a moved card all survived. See `docs/part7-after-restart.png`
- [x] No unnecessary `PUT` storms; an e2e test counts requests during a seven-keystroke rename and asserts exactly one `PUT`
- [x] All tests pass: 34 backend, 25 frontend unit, 21 e2e

---

## Part 8: AI connectivity

Prove the OpenRouter call works before building anything on top of it.

- [x] Re-check the model on OpenRouter before writing code against it, since free variants get retired. Its only endpoint is up and lists `tools` and `tool_choice` with `supports_tool_choice.function`, but no `response_format` or `structured_outputs`, which confirms the Part 1 finding
- [x] Implement `ai.py` posting to OpenRouter chat completions with `httpx2`, which imports as `httpx2` and exposes `AsyncClient`
- [x] Send the `HTTP-Referer` and `X-Title` headers OpenRouter expects
- [x] Read the model from `OPENROUTER_MODEL`, defaulting to `nvidia/nemotron-3.5-lightning:free`
- [x] Make `chat_completion` take optional `tools` and `tool_choice` and return the raw message dict, so Part 9 only adds the tool definition and the prompt
- [x] Add a `live` pytest marker, deselected by default via `addopts = "-m 'not live'"`
- [x] Add `scripts/test-ai.ps1` and `scripts/test-ai.sh`, the only scripts that pass `.env` into the test container, so the default backend run still needs no key
- [x] Confirm a sane answer comes back from the live API
- [x] Handle a missing or rejected API key with a clear error rather than a stack trace. Everything raises `AIError`, including a 200 carrying an error body with no `choices`, which is how OpenRouter reports some upstream provider failures
- [x] Note the free tier's rate limits in the README

**Tests**

- [x] Live, run manually and excluded from the default suite: the 2+2 call returns a response containing "4"
- [x] Live: a forced tool call comes back as a `tool_calls` entry with parseable JSON arguments, pulled forward from Part 9 to de-risk it
- [x] Backend unit with a mocked transport: a normal response is parsed correctly
- [x] Backend unit: the request carries the key, the model, and the attribution headers
- [x] Backend unit: `tools` and `tool_choice` are forwarded, and omitted when not passed
- [x] Backend unit: a tool call response is returned intact
- [x] Backend unit: a missing key raises before any network call
- [x] Backend unit: a 401 from OpenRouter raises a clear configuration error
- [x] Backend unit: a 429 names the free-tier limits
- [x] Backend unit: a network timeout is surfaced as a clean error
- [x] Backend unit: a 200 with no choices is an error rather than a `KeyError`

**Success criteria**

- [x] The live 2+2 call demonstrably returns 4
- [x] The live forced tool call demonstrably returns structured arguments, so Part 9's mechanism is proven
- [x] A genuinely invalid key against the real API produces the `AIError` message, not a raw stack trace
- [x] The default test suite passes without network access, because live calls are opt-in: 43 passed, 2 deselected

---

## Part 9: AI board updates

Every chat call sends the current board plus the question and history. The model replies through a single forced tool call carrying its answer and, optionally, a replacement board.

- [x] Define one tool, `respond_to_user`, with parameters `reply` (string, required) and `board` (full `BoardData`, optional)
- [x] Generate the `board` parameter's schema from `BoardData.model_json_schema()` instead of hand-writing it, hoisting `$defs` to the root of `parameters` so the generated `$ref`s resolve. One less copy of the board shape to keep in sync
- [x] Call OpenRouter with `tools` and `tool_choice` pinned to that tool, so every response is structured
- [x] Build a system prompt explaining the board shape and that `board` should be omitted unless a change was requested
- [x] Serialize the user's current board into the prompt
- [x] Pass conversation history through from the request
- [x] Implement `POST /api/chat` returning `{reply, board_updated}`
- [x] Validate any returned board against the pydantic models plus the Part 6 integrity rules before writing it
- [x] On validation failure, return the reply with `board_updated: false` and leave the stored board untouched
- [x] Handle a malformed or absent tool call by falling back to any plain message content
- [x] Map `AIError` to a 502, so an OpenRouter outage is not a 500
- [x] Require a session, so chat is scoped to the signed-in user's board
- [x] Raise `ai.TIMEOUT` to 180s after measuring a 92s add-a-card call. Whole-board replacement means the model reproduces all eight cards to add one

**Tests**

All of these mock the OpenRouter transport; no live calls in the suite.

- [x] Backend: a question with no board change returns the reply and `board_updated: false`, and the stored board is unchanged
- [x] Backend: a tool call containing a valid board persists it and returns `board_updated: true`
- [x] Backend: an added card appears in the stored board
- [x] Backend: a moved card is reflected in the stored `cardIds`
- [x] Backend: an invalid returned board is rejected, `board_updated` is false, and the stored board is untouched
- [x] Backend: a board that is not an object at all is rejected the same way
- [x] Backend: a missing tool call falls back to message content without erroring
- [x] Backend: unparseable tool arguments fall back to message content
- [x] Backend: a reply with no tool call and no content is a 502, not a 500
- [x] Backend: an OpenRouter failure is a 502 carrying the reason
- [x] Backend: the outgoing request contains the current board JSON, the passed history, and the pinned tool
- [x] Backend: the prompt carries the current board rather than the seed, after the board has been changed
- [x] Backend: `/api/chat` without a session returns 401
- [x] Backend: a malformed chat body returns 422
- [x] Live, manual: ask the model to add a card and confirm it lands on the real board
- [x] Live, manual: ask a question and confirm the board is left untouched

**Success criteria**

- [x] Every mocked scenario passes: 57 backend, 4 deselected live
- [x] One real end-to-end request to the live model successfully adds a card. It added "Book the venue" to Backlog, with the other eight cards intact
- [x] A bad AI response can never corrupt a stored board, since the AI path reuses the same `BoardData` validator as `PUT /api/board`

---

## Part 10: AI chat sidebar

- [x] Build a collapsible sidebar matching the palette, with a message list, input, and send button
- [x] Hold conversation history in React state and send it with each request
- [x] Distinguish user and assistant messages visually
- [x] Show a thinking indicator while a request is in flight. Part 9 measured a board change at 92 seconds on the free tier, so this has to tolerate a long wait rather than look hung. The indicator pulses and says board changes can take a minute or two
- [x] Refetch the board automatically when the response has `board_updated: true`. `KanbanBoard` uses `setBoard` rather than `mutate`, so the AI write is never PUTted back
- [x] Show a subtle confirmation when the AI changed the board, attached to that assistant turn
- [x] Handle chat errors inline without losing the conversation
- [x] Make the sidebar responsive and keep the board usable at narrow widths. Below `lg` it covers the board; at `lg` and up the board reserves `pr-[430px]`
- [x] Keyboard support: Enter sends, Shift+Enter adds a newline
- [x] Confirm the sidebar is reachable and operable by keyboard alone. Opening focuses the input; Close has an accessible name

**Tests**

- [x] Unit: sidebar opens and closes
- [x] Unit: sending a message renders it and then the mocked reply
- [x] Unit: the thinking indicator shows while pending
- [x] Unit: a `board_updated: true` response triggers a board refetch
- [x] Unit: a `board_updated: false` response does not refetch
- [x] Unit: a failed request shows an error and preserves history
- [x] Unit: history accumulates across turns and is sent onward
- [x] Unit: Enter sends, Shift+Enter inserts a newline, empty input does not send
- [x] Unit: a 401 from chat reports unauthorized rather than an inline error
- [x] e2e: open the sidebar, send a message, receive a reply. `/api/chat` is mocked so the default suite does not spend free-tier quota
- [x] e2e: the board stays usable with the sidebar open
- [x] e2e: the sidebar opens, sends, and closes from the keyboard alone
- [x] e2e with the live model: ask for a new card and watch the board update without a manual reload. Tagged `@live`, excluded unless `LIVE_AI=1`. Took 1.3 minutes. The first draft of this test matched the user message, which already contains the card title; it now waits for the assistant turn and asserts a heading inside Backlog

**Success criteria**

- [x] A user can hold a conversation and see board changes appear without reloading
- [x] The AI can create, edit, and move cards through chat
- [x] Full suite green: 57 backend, 39 frontend unit, 24 e2e. Live e2e passed separately
- [x] The palette is respected and no hardcoded hex values were added. Chat colors go through `--primary-blue-soft` and `--secondary-purple-soft`

---

## Definition of done

- [x] `docker compose up --build` from a clean checkout yields a working app on port 8000
- [x] Sign in with `user` / `password`, use the board, chat with the AI, sign out
- [x] All state persists across container restarts
- [x] Start and stop scripts exist for Mac, Windows, and Linux
- [x] Frontend unit, backend unit, and e2e suites all pass
- [x] `README.md`, `docs/DATABASE.md`, and the `AGENTS.md` files are accurate
- [x] No secrets committed
