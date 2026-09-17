# Frontend

NextJS Kanban board with sign in. The board is loaded from and saved to the backend, so every change survives a reload and a container restart.

## Stack

- Next 16.3.5, App Router, TypeScript strict
- React 19.2.3
- Tailwind CSS 4 via `@tailwindcss/postcss` (no `tailwind.config`; theme lives in `globals.css`)
- `@dnd-kit/core` + `@dnd-kit/sortable` for drag and drop
- `clsx` for conditional classes
- Vitest + Testing Library (unit), Playwright (e2e)
- Import alias `@/*` maps to `./src/*`

## Layout

```
frontend/
  next.config.ts        empty config
  vitest.config.ts      jsdom, globals: true, includes src/**/*.{test,spec}.{ts,tsx}
  playwright.config.ts  testDir tests/, baseURL http://127.0.0.1:8000, workers: 1
  src/
    app/
      layout.tsx        fonts + metadata
      page.tsx          renders <AppShell />
      globals.css       CSS variables and theme
    components/
      AppShell.tsx           session gate: loading, then login or board
      AppShell.test.tsx
      LoginForm.tsx          sign in form, calls the api wrapper
      KanbanBoard.tsx        loads, owns, mutates and saves the board
      KanbanColumn.tsx       droppable column, rename input, card list
      KanbanCard.tsx         sortable card, inline edit form, Edit and Remove buttons
      KanbanCardPreview.tsx  non-interactive copy shown in the DragOverlay
      NewCardForm.tsx        collapsed "Add a card" button expanding to a form
      ChatSidebar.tsx        collapsible AI chat, holds conversation history
      ChatSidebar.test.tsx
      KanbanBoard.test.tsx
    lib/
      api.ts            fetch wrapper, relative /api paths, credentials included
      kanban.ts         types, test fixture, moveCard, createId
      kanban.test.ts
    test/
      setup.ts, vitest.d.ts
  tests/
    helpers.ts          signIn, signInWithFreshBoard, waitForBoardSave, mockChat
    auth.spec.ts        Playwright e2e for sign in
    kanban.spec.ts      Playwright e2e for the board
    chat.spec.ts        Playwright e2e for the sidebar; the live test is tagged @live
```

## Data model

Defined in `src/lib/kanban.ts`. Normalized: columns hold an ordered list of card ids, cards live in a lookup keyed by id.

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

These types mirror `BoardData` in `backend/app/schemas.py`, which validates every `PUT`.

`initialData` is a test fixture only: unit tests mock `getBoard()` with it, and `signInWithFreshBoard` PUTs it to reset the board between e2e tests. It must stay in sync with `backend/app/seed.py`, which is what actually seeds a new user. It covers five columns (`col-backlog`, `col-discovery`, `col-progress`, `col-review`, `col-done`) and eight cards (`card-1` through `card-8`).

## Session

`AppShell` is the only entry point. On mount it calls `getMe()`; a 401 renders `LoginForm`, success renders `KanbanBoard` with `username`, `onSignOut` and `onUnauthorized`. Because the app is a static export there is no middleware and no `/login` route, so gating is client-side and the backend enforces auth on every API call.

`lib/api.ts` always uses relative `/api` paths with `credentials: "include"`. In dev the NextJS rewrite makes that same-origin, so the session cookie works without CORS. Board and chat calls throw `UnauthorizedError` on a 401; `KanbanBoard` turns that into `onUnauthorized()`, and `AppShell` clears `username` so the user lands back on the login form. `onUnauthorized` is wrapped in `useCallback` because it sits in the board fetch effect's dependencies.

`sendChat(message, history)` posts to `/api/chat` and maps `board_updated` to `boardUpdated`. History is whatever the sidebar currently holds, minus the message just being sent.

## Chat

`ChatSidebar` owns the conversation. Open state lives in `KanbanBoard` so the board can reserve `lg:pr-[430px]` when there is room for both. Below `lg` the sidebar covers the board full-width rather than squeezing the columns.

Sending appends the user turn immediately, then POSTs `{message, history}`. A `boardUpdated: true` reply calls `onBoardUpdated`, which `KanbanBoard` handles by `getBoard()` into `setBoard` rather than `mutate`, so the AI write is never PUTted back. The "Board updated" confirmation is stored on that assistant turn so it stays attached as the conversation grows.

The thinking indicator pulses and says board changes can take a minute or two, because a live add-a-card call measured 92 seconds on the free tier. Enter sends, Shift+Enter inserts a newline. Opening the sidebar focuses the input.

A failed request keeps every turn already on screen and shows an inline error. A 401 calls `onUnauthorized` instead.

## State

`KanbanBoard` holds `useState<BoardData | null>`, null while `getBoard()` is in flight, plus `activeCardId` for the drag overlay. All mutations are local handlers passed down as props:

- `handleRenameColumn(columnId, title)` - fires on every keystroke of the column title input
- `handleAddCard(columnId, title, details)` - generates an id via `createId("card")`; empty details become `"No details yet."`
- `handleEditCard(cardId, title, details)` - takes no `columnId`, because `cards` is a flat record
- `handleDeleteCard(columnId, cardId)` - removes from both `cards` and the column's `cardIds`
- `handleDragEnd` - delegates to `moveCard`

## Persistence

Every handler goes through `mutate(updater)`, which applies the change to local state immediately and flags a pending save. A separate effect watching `board` schedules a `PUT /api/board` after `SAVE_DELAY_MS` (300ms) and clears the timer whenever `board` changes again, so a burst of changes coalesces into one request. This is what keeps a column rename, which fires on every keystroke, from turning into a `PUT` per character. There is one e2e test asserting exactly one `PUT` for a multi-keystroke rename; do not replace the debounce with a save-per-handler.

The pending-save flag is what stops the effect from writing back a board it just read: loads and error resyncs call `setBoard` directly rather than `mutate`.

A failed save shows a non-blocking banner and refetches, so the UI resyncs to whatever the server actually holds rather than sitting on rejected state.

A change still waiting on the debounce is not dropped when the board goes away. `flushSave` sends it immediately with `fetch` `keepalive`, and runs on `pagehide`, on unmount, and before `onSignOut` (awaited there, so the save lands before the logout). The latest board is mirrored into a ref for this. The debounce timer checks the pending flag before sending, so a flushed change is never sent twice.

Cards move with the keyboard as well as the pointer: `KeyboardSensor` with `sortableKeyboardCoordinates`. Focus a card, Space to pick it up, arrows to move, Space to drop. `KanbanCard` registers the card as its own activator node (`setActivatorNodeRef`), otherwise Enter or Space on its Edit and Remove buttons would bubble up and start a drag instead of pressing the button.

`KanbanCard` owns its own `isEditing` state and a `draft` copy of the card. Editing passes `disabled: isEditing` to `useSortable` and stops spreading the drag listeners, otherwise the listeners swallow pointer events meant for the inputs. Discarding drops the draft without calling back up.

`moveCard(columns, activeId, overId)` in `lib/kanban.ts` is pure and covers reorder-within-column, move-to-another-column, and drop-on-empty-column (appends to end). It only touches `columns`, never `cards`.

## Styling

Palette is defined once as CSS variables in `globals.css` and referenced as `text-[var(--navy-dark)]` etc. Do not hardcode hex values in components.

`--accent-yellow: #ecad0a`, `--primary-blue: #209dd7`, `--secondary-purple: #753991`, `--navy-dark: #032147`, `--gray-text: #767676` (the lightest gray meeting WCAG AA on white), plus `--surface`, `--surface-strong`, `--stroke`, `--shadow`, `--primary-blue-soft`, `--secondary-purple-soft`.

Fonts are Space Grotesk (display, via the `.font-display` class) and Manrope (body), loaded through `next/font/google` in `layout.tsx`. `.thinking` is a slow opacity pulse used by the chat waiting state.

## Test hooks

Keep these stable; both test suites depend on them.

- `data-testid="column-${column.id}"` on each column
- `data-testid="card-${card.id}"` on each card
- `aria-label="Column title"` on the rename input
- `aria-label="Edit ${card.title}"` on the Edit button, `aria-label="Delete ${card.title}"` on Remove
- `aria-label="Edit title"` and `aria-label="Edit details"` on the inline edit inputs
- Placeholders `Card title` and `Details` in the new card form
- The edit form's cancel button says "Discard", not "Cancel", so it cannot be confused with the new card form's Cancel when both are open in one column
- `aria-label="Username"` and `aria-label="Password"` on the login inputs
- `data-testid="login-error"` on the login error. Do not use `getByRole("alert")` in e2e tests: NextJS injects a route announcer with the same role, so the query matches two elements and fails strict mode
- `data-testid="session-loading"` while the session check is in flight
- `data-testid="board-loading"` while the board fetch is in flight, `data-testid="board-error"` if it fails
- `data-testid="save-error"` on the non-blocking save failure banner
- `data-testid="chat-toggle"` on the closed-state Ask AI button, `data-testid="chat-sidebar"` when open
- `aria-label="Message"` on the chat textarea, `aria-label="Close assistant"` on Close
- `data-testid="chat-user"` / `data-testid="chat-assistant"` on each turn, `data-testid="chat-thinking"` while waiting, `data-testid="chat-error"` on a failed send, `data-testid="chat-board-updated"` on the confirmation

Scripts: `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, `npm run test:all` (all three). Vitest strips types without checking them, so `typecheck` is what catches type errors in tests; `src/test/vitest.d.ts` references `vitest/globals` to type the globals `vitest.config.ts` enables. The e2e live test is tagged `@live` and excluded unless `LIVE_AI=1`.

## Build modes

`next.config.ts` branches on the `BUILD_STATIC` environment variable:

- `BUILD_STATIC=1` gives `output: "export"` plus unoptimized images, producing `out/` for FastAPI to serve. This is what the Dockerfile runs.
- Unset means `next dev`, where `/api/*` is rewritten to `127.0.0.1:8000`. That keeps the browser same-origin, so session cookies work with no CORS setup.

## Gotchas

- `next/font/google` downloads font files at build time, so the Docker build stage needs network access.
- Card ids are generated client-side by `createId` (`Math.random` plus a timestamp) and the backend stores them as given.
- e2e tests run against the container on port 8000 and do not start a server themselves, so bring the app up first. Set `BASE_URL` to target `next dev` instead. The live chat test is tagged `@live` and skipped unless `LIVE_AI=1`; it needs a 240 second timeout because a board change takes around 90 seconds.
- e2e runs with `workers: 1`. There is one board for one user, so parallel tests would overwrite each other now that changes persist.
- Any e2e test that mutates the board must use `signInWithFreshBoard`, and any test that reloads to check persistence must `await waitForBoardSave(page)` first, set up before the action that triggers the save.
- Unit tests must mock `@/lib/api` with `importOriginal` so the real `UnauthorizedError` class survives; the component checks it with `instanceof`, and a fully automocked class breaks that.
- Static export means no server-side routing. A deep link to any path other than `/` will 404, which is fine while the app is a single route but matters if routes are ever added.
