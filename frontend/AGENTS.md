# Frontend

NextJS Kanban board with sign in. The board is loaded from and saved to the backend, so every change survives a reload and a container restart.

## Stack

- Next 16.1.6, App Router, TypeScript strict
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
      KanbanBoard.test.tsx
    lib/
      api.ts            fetch wrapper, relative /api paths, credentials included
      kanban.ts         types, test fixture, moveCard, createId
      kanban.test.ts
    test/
      setup.ts, vitest.d.ts
  tests/
    helpers.ts          signIn, signInWithFreshBoard, waitForBoardSave
    auth.spec.ts        Playwright e2e for sign in
    kanban.spec.ts      Playwright e2e for the board
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

`lib/api.ts` always uses relative `/api` paths with `credentials: "include"`. In dev the NextJS rewrite makes that same-origin, so the session cookie works without CORS. Board calls throw `UnauthorizedError` on a 401; `KanbanBoard` turns that into `onUnauthorized()`, and `AppShell` clears `username` so the user lands back on the login form. `onUnauthorized` is wrapped in `useCallback` because it sits in the board fetch effect's dependencies.

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

`KanbanCard` owns its own `isEditing` state and a `draft` copy of the card. Editing passes `disabled: isEditing` to `useSortable` and stops spreading the drag listeners, otherwise the listeners swallow pointer events meant for the inputs. Discarding drops the draft without calling back up.

`moveCard(columns, activeId, overId)` in `lib/kanban.ts` is pure and covers reorder-within-column, move-to-another-column, and drop-on-empty-column (appends to end). It only touches `columns`, never `cards`.

## Styling

Palette is defined once as CSS variables in `globals.css` and referenced as `text-[var(--navy-dark)]` etc. Do not hardcode hex values in components.

`--accent-yellow: #ecad0a`, `--primary-blue: #209dd7`, `--secondary-purple: #753991`, `--navy-dark: #032147`, `--gray-text: #888888`, plus `--surface`, `--surface-strong`, `--stroke`, `--shadow`.

Fonts are Space Grotesk (display, via the `.font-display` class) and Manrope (body), loaded through `next/font/google` in `layout.tsx`.

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

Scripts: `npm run test:unit`, `npm run test:e2e`, `npm run test:all`.

## Build modes

`next.config.ts` branches on the `BUILD_STATIC` environment variable:

- `BUILD_STATIC=1` gives `output: "export"` plus unoptimized images, producing `out/` for FastAPI to serve. This is what the Dockerfile runs.
- Unset means `next dev`, where `/api/*` is rewritten to `127.0.0.1:8000`. That keeps the browser same-origin, so session cookies work with no CORS setup.

## Not implemented yet

- AI chat sidebar

## Gotchas

- `next/font/google` downloads font files at build time, so the Docker build stage needs network access.
- Card ids are generated client-side by `createId` (`Math.random` plus a timestamp) and the backend stores them as given.
- e2e tests run against the container on port 8000 and do not start a server themselves, so bring the app up first. Set `BASE_URL` to target `next dev` instead.
- e2e runs with `workers: 1`. There is one board for one user, so parallel tests would overwrite each other now that changes persist.
- Any e2e test that mutates the board must use `signInWithFreshBoard`, and any test that reloads to check persistence must `await waitForBoardSave(page)` first, set up before the action that triggers the save.
- Unit tests must mock `@/lib/api` with `importOriginal` so the real `UnauthorizedError` class survives; the component checks it with `instanceof`, and a fully automocked class breaks that.
- Static export means no server-side routing. A deep link to any path other than `/` will 404, which is fine while the app is a single route but matters if routes are ever added.
