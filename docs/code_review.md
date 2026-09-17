# Code Review

Reviewed 2026-09-15 at commit `8d7bf2c` (branch `cursor/agent-model-31810`). Whole repository: backend, frontend, Docker, scripts, tests and docs.

## Summary

The MVP is in good shape. The suites are green, the docs match the code, and the main design decisions hold up. There are 3 high, 7 medium and 9 low findings. Two of the high findings are one-line or one-command fixes. The third, AI chat overwriting edits made while it is thinking, is the only real correctness bug. It matters because board changes take around 90 seconds and the board is meant to stay usable with the sidebar open.

| Priority | Count | Theme |
|---|---|---|
| High | 3 | Lost updates from AI chat, vulnerable Next.js, app reachable from the network |
| Medium | 7 | Error mapping, dev-mode AI key, type checking, unbounded chat input, unsaved edits on exit, accessibility |
| Low | 9 | Container hardening, onboarding, auth edge cases, small cleanups |

## How this was reviewed

Every source, config, script and doc file was read. Findings marked **Verified** were reproduced. The rest come from reading the code, and each one cites the lines involved.

| Check | Result |
|---|---|
| Backend tests, `scripts/test-backend.ps1` | 57 passed, 4 live deselected |
| Frontend unit tests, `npm run test:unit` | 39 passed |
| e2e tests, `npm run test:e2e` against the container | 24 passed |
| `npm run lint` | Clean |
| `npx tsc --noEmit` | **168 errors**, all in test files (see M3) |
| `npm audit --omit=dev` | 5 advisories, 1 critical (see H2) |
| `.env` in git | Not tracked and not in history |
| Probe of `/api/chat` with a mocked OpenRouter | Reproduced H1 and M1 |

---

## High

### H1. AI chat overwrites board edits made while the model is thinking

**Verified.** `backend/app/chat.py:80` reads the board before the OpenRouter call, and `chat.py:102` saves the model's board afterwards without checking whether the stored board changed in the meantime. The model's board is built from the old snapshot, so any change the user made during the call is silently lost.

This is easy to hit, not a theoretical race. A board change takes around 90 seconds. The sidebar is designed to leave the board usable, and an e2e test checks exactly that. When the AI finishes, the frontend refetches and the user's edits disappear.

Reproduced with a mocked OpenRouter: the user renamed a column mid-call, the AI added a card, and the final board had the AI card but the column was back to `Backlog`.

**Action**

- Make the AI save conditional. Pass the `updated_at` read at `chat.py:80` into the save, and write with `UPDATE boards SET data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?`.
- If no row is updated, don't store the AI board. Return the reply with `board_updated: false` and a short note that the board changed while the assistant was working, so the user can ask again.
- Add a backend test that edits the board inside the mocked OpenRouter handler and asserts that the edit survives.
- `db.board_updated_at` (`db.py:121`) is currently only used by tests. This fix gives it a production use.

### H2. Next.js 16.1.6 has a critical advisory; the fix is a minor bump

**Verified.** `npm audit --omit=dev` flags `next` as critical, plus `postcss`, `sharp` and `nanoid` as high, all pulled in through `next`. The fix is `next@16.3.5`, which is not a semver-major change. It only fails to install automatically because `package.json:21` pins `next` to exactly `16.1.6`.

Production exposure is limited, because the container serves a static export and never runs the Next server. The exposure is on developer machines. `scripts/dev.ps1` and `scripts/dev.sh` run `next dev` with the `/api` rewrite, and several advisories target exactly that: request smuggling and SSRF in rewrites, and a CSRF bypass on the dev HMR websocket. The root `AGENTS.md` also asks for current library versions.

**Action**

- Set `next` and `eslint-config-next` to `16.3.5` in `frontend/package.json`, run `npm install`, then `npm audit fix` for the remaining transitive advisories.
- Re-run all three suites and `docker compose up --build`.

### H3. The app is reachable from the local network with a well-known password

`docker-compose.yml:6` publishes `"8000:8000"`, which binds to every interface. The only account is `user` / `password`, and the session cookie is sent over plain HTTP. On a shared or public network, anyone who can reach the machine can sign in, read and change the board, and spend the OpenRouter quota through `/api/chat`. The requirements say the MVP runs locally, so nothing needs the wider binding.

**Action**

- Change the mapping to `"127.0.0.1:8000:8000"`. `http://localhost:8000` and the e2e suite keep working unchanged.

---

## Medium

### M1. A malformed OpenRouter reply returns 500 instead of 502

**Verified.** `backend/app/ai.py:63` calls `response.json()` and `ai.py:66` reads `choices[0]["message"]`, and neither is guarded. A 200 with a non-JSON body (for example an HTML error page from a proxy) raises `JSONDecodeError`. A choice with no `message` raises `KeyError`. Neither is an `AIError`, so `chat.py:90` doesn't catch them and the user gets a 500. Both reproduced as `500 Internal Server Error`.

The code already handles a 200 with no `choices`, and its comment says OpenRouter does return odd 200s, so these neighbouring cases are real too.

**Action**

- In `ai.py`, raise `AIError` when the body isn't JSON, isn't an object, or the first choice has no `message`.
- Add two tests to `backend/tests/test_ai.py`, one for each case.

### M2. AI chat doesn't work in local dev mode

`scripts/dev.ps1:16-17` and `scripts/dev.sh:21` start uvicorn without loading `.env`, and `backend/app/config.py:10` only reads the process environment. In dev mode `OPENROUTER_API_KEY` is empty, so every chat request returns 502 "OPENROUTER_API_KEY is not set". Only the Docker path, which uses `env_file` in compose, has the key. The README presents dev mode as the hot-reload equivalent of the container, with no mention of this.

**Action**

- Start the backend with `uv run --frozen --env-file ../.env uvicorn ...` in both dev scripts.

### M3. TypeScript checking fails and nothing runs it

**Verified.** `npx tsc --noEmit` reports 168 errors (`Cannot find name 'it'`, `'expect'`, `'vi'`) across the unit test files. The cause is `frontend/src/test/vitest.d.ts:1`, which references `vitest` rather than `vitest/globals`, while `vitest.config.ts` enables `globals: true`. Running with the `vitest/globals` types brings the count to 0. No script runs `tsc`, so type errors in tests go unnoticed. Vitest strips types without checking them.

**Action**

- Change `vitest.d.ts:1` to `/// <reference types="vitest/globals" />`.
- Add `"typecheck": "tsc --noEmit"` to `frontend/package.json` and include it in `test:all`.

### M4. Chat history and request sizes are unbounded

`ChatSidebar.tsx:48` sends the entire conversation on every turn. `ChatRequest` (`schemas.py:67-71`) puts no limit on `history` or `message`, and `BoardData` puts no limit on titles, details or card counts. Each turn resends the full history plus the whole board JSON (`chat.py:81-85`), so prompts grow with every turn. Latency and quota use grow with them, and a long conversation will eventually exceed the model's context and fail as a 502. `PUT /api/board` will also store a payload of any size.

**Action**

- Server-side, send only the most recent turns to the model (for example the last 20). Server-side means an old or modified client can't bypass the limit.
- Add `max_length` to `ChatRequest.message` and to the card and column string fields, sized well above anything the UI produces.

### M5. An edit made just before signing out or closing the tab is lost

The save is debounced by 300ms, and the effect cleanup at `frontend/src/components/KanbanBoard.tsx:87` clears the pending timer. When the board unmounts because the user signed out or the session expired, the queued `PUT` is cancelled. Closing or reloading the tab inside the window drops it too, because nothing flushes on `pagehide`. The e2e suite has to call `waitForBoardSave` before every reload for this reason. Users get no such wait.

**Action**

- Keep the latest board in a ref. On unmount, and on a `pagehide` listener, send any pending save straight away using `fetch(..., { keepalive: true })`.
- Leave the per-change cleanup as it is, so the debounce and the one-`PUT`-per-rename e2e test still hold.

### M6. Gray text fails WCAG AA contrast

`--gray-text: #888888` (`globals.css:8`) on white has a contrast ratio of 3.54:1. WCAG AA requires 4.5:1 for normal-size text. It is used for card details (`text-sm`), descriptions and helper text, not just large labels. The colour comes from the palette in the root `AGENTS.md`, so changing it needs a decision.

**Action**

- Agree a darker gray and update it in `AGENTS.md` and `globals.css`. `#767676` is the lightest gray that passes (4.54:1). No component changes are needed, because every use goes through the variable.

### M7. Cards can't be moved with the keyboard

`KanbanCard.tsx:22-23,44` spreads dnd-kit's `attributes` onto each card, which tells assistive technology the card is sortable and puts it in the tab order. But `KanbanBoard.tsx:43-47` registers only `PointerSensor`, so keyboard users can focus a card and never move it. Their only route is asking the AI, which takes around 90 seconds per change.

**Action**

- Add `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })` to the sensors.
- Add an e2e test that moves a card with Space and the arrow keys.

---

## Low

### L1. The container runs as root

The runtime stage of `Dockerfile` (lines 16-39) never sets `USER`, so uvicorn runs as root.

**Action:** create an unprivileged user, give it ownership of `/app` and `/data`, and add `USER` before `CMD`. Check that an existing `pm-data` volume is still writable afterwards.

### L2. `.env` is not in `.dockerignore`

The Dockerfile copies only specific paths, so the key doesn't end up in the image today. It is still sent to the Docker daemon as part of the build context, and a future broad `COPY` would bake it in.

**Action:** add `.env` to `.dockerignore`.

### L3. No `.env` template

The README requires an `.env` with `OPENROUTER_API_KEY`, and `docker compose` fails without one, but the repo has no example to copy.

**Action:** commit `.env.example` containing `OPENROUTER_API_KEY=` and point the README at it.

### L4. The `.sh` Docker scripts fail under Git Bash on Windows

**Verified** for `scripts/test-backend.sh`. Git Bash rewrites the container paths, so the working directory becomes `C:/Program Files/Git/app` and `docker run` fails. `scripts/test-ai.sh:6-14` uses the same pattern. The `.ps1` versions work.

**Action:** prefix the `docker run` lines with `MSYS_NO_PATHCONV=1`, which has no effect on Mac and Linux.

### L5. Login response time reveals whether a username exists

`auth.py:38-39` skips the PBKDF2 check for an unknown user, so it responds much faster than for a real user with a wrong password.

**Action:** when the user doesn't exist, still run `verify_password` against a fixed dummy hash. Low priority while there is one user.

### L6. Sessions can't be revoked, and the cookie isn't marked `Secure`

The session is a signed cookie with no server-side state, so logout (`auth.py:53-56`) only deletes the browser's copy. A copied cookie stays valid for 7 days. `set_cookie` (`auth.py:42-49`) doesn't set `secure`. Both are reasonable for a local HTTP MVP.

**Action:** none now. Revisit before any non-local deployment, by setting `secure=True` behind HTTPS and adding a session version or server-side store if revocation is needed.

### L7. "Columns are fixed" is only enforced by the prompt

The system prompt (`chat.py:46`) tells the model to keep the five columns, but the `BoardData` validator (`schemas.py:34-59`) doesn't check it. An AI reply, or any client, can remove a column together with its cards and the save succeeds. `docs/DATABASE.md` documents this as intentional.

**Action:** if the rule matters, reject saves whose column ids differ from the stored board's. Otherwise leave as is.

### L8. Overlapping saves can arrive out of order

Clearing the timer doesn't cancel a `PUT` that is already in flight (`KanbanBoard.tsx:66-87`), so two whole-board saves can overlap and the older one can arrive last. This is unlikely with a 300ms debounce on localhost.

**Action:** if M5 touches this code anyway, chain saves so only one request is in flight at a time.

### L9. Unmatched `/api` paths can reach the static site

`main.py:21` only catches GET, POST, PUT and DELETE. A HEAD, PATCH or OPTIONS request to an unknown `/api` path falls through to the static mount and gets an HTML or plain-text response, not the JSON 404.

**Action:** add the missing methods to the fallback route.

---

## Minor cleanups

- `frontend/public/` contains the five create-next-app sample SVGs. Nothing in `src` references them; delete them.
- `moveCard` hand-rolls `arrayMove` (`kanban.ts:127-129`), which `@dnd-kit/sortable` already provides.
- `createId` (`kanban.ts:166-170`) uses `Math.random`. `crypto.randomUUID()` is the current idiomatic choice.
- `AppShell.handleSignOut` (`AppShell.tsx:19-22`) never reaches `setUsername(null)` if `logout()` throws on a network error, and the rejection goes unhandled. Clear the username in a `finally`.
- `initialData` (`kanban.ts:20`) is a test-only fixture kept in `src/lib`, and it is a hand-maintained copy of `backend/app/seed.py`. Moving it to `src/test/` would make its role obvious. Keeping the copies in sync stays a manual step, as both `AGENTS.md` files already note.

## What is in good shape

- **One validator for every write.** `BoardData` is the only place board integrity is checked, and both `PUT /api/board` and AI output go through it. A bad board can't be stored, whichever path it comes from.
- **The tool schema can't drift.** It is generated from the pydantic model rather than written by hand.
- **Secrets stay out of git.** `.env` is ignored and absent from history. Live AI tests are opt-in, and the default suites need no key or network.
- **Low XSS and CSRF risk.** React escapes all chat and card text, and nothing uses `dangerouslySetInnerHTML`. The session cookie is `HttpOnly` and `SameSite=Lax`, and the API only accepts JSON, which covers CSRF for this app.
- **Reliable tests.** The suites are fast and isolated: a fresh database per backend test, a board reset per e2e test, and mocked AI calls. Test hooks are documented so refactors don't break them.
- **Accurate docs.** `docs/PLAN.md`, `docs/DATABASE.md` and the `AGENTS.md` files match the code closely enough to work from.

## Action checklist

In suggested order: quick high-value fixes first, then the larger changes.

- [x] H3: bind the published port to `127.0.0.1`
- [x] H2: upgrade `next` and `eslint-config-next` to 16.3.5, run `npm audit fix`, re-run the suites. Production audit is clean; a dev-only vitest advisory remains that needs vitest 5
- [x] M3: switch `vitest.d.ts` to `vitest/globals` and add a `typecheck` script to `test:all`
- [x] M2: load `.env` in `dev.ps1` and `dev.sh`
- [x] M1: map a non-JSON body or a choice without `message` to `AIError`, with tests
- [x] H1: make the AI board save conditional on `updated_at`, with a concurrent-edit test
- [x] M4: limit chat history sent to the model and add `max_length` to request fields
- [x] M5: send any pending board save on unmount, on `pagehide` and before sign out
- [x] M7: add `KeyboardSensor` with an e2e test
- [x] M6: `#767676`, updated in `AGENTS.md` and `globals.css`
- [ ] L1-L4: non-root container, `.env` in `.dockerignore`, `.env.example`, `MSYS_NO_PATHCONV` in the `.sh` scripts
- [ ] L5, L7-L9 and the minor cleanups, as time allows
- [ ] L6: revisit before any non-local deployment
