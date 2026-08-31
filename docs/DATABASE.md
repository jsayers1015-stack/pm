# Database

SQLite, created on first run if the file does not exist. The whole Kanban board is stored as a single JSON document per user rather than as normalized rows.

Location is `DB_PATH`, which is `/data/pm.db` in Docker. `/data` is a named volume, so the database survives container restarts and rebuilds. The signing key for session cookies lives beside it as `/data/secret_key`.

## Why JSON rather than normalized tables

The frontend already holds the board as one `BoardData` object and replaces it wholesale on every change. The AI, per the Part 9 design, also returns a complete replacement board. Nothing in the MVP reads or writes a single card in isolation.

Given that, normalized `columns` and `cards` tables would buy nothing and cost real work: every save would become a diff against stored rows, plus ordering columns, cascade deletes, and transaction handling. Storing the JSON as-is means:

- No translation layer. What the browser holds, what the API sends, and what is stored are the same shape.
- Card ordering is just array order, which is what the UI needs anyway. No `position` column to renumber on every drag.
- One row to read, one row to write.

The tradeoff is that SQL cannot query inside a board. You cannot ask "which cards mention onboarding" without loading and parsing the JSON. That is fine for one board per user, and the migration path below covers it if that changes.

## Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`users` exists as of Part 4. `boards` is added in Part 6.

| Column | Notes |
|---|---|
| `users.username` | `UNIQUE`. The MVP seeds exactly one, `user`, but nothing here is single-user |
| `users.password_hash` | `salt$hash`, PBKDF2-SHA256 at 200k rounds with a per-user hex salt |
| `boards.user_id` | `UNIQUE`, which enforces one board per user. Dropping the constraint is all that is needed to allow several |
| `boards.data` | The `BoardData` JSON document, serialized as text |
| `boards.updated_at` | ISO 8601 UTC timestamp, rewritten on every save |

`boards.user_id` is `UNIQUE` rather than a plain foreign key on purpose: it makes the one-board-per-user limit a database guarantee instead of an assumption in application code.

Note that SQLite does not enforce foreign keys unless `PRAGMA foreign_keys = ON` is set per connection. The reference above is declarative documentation of intent. With a single seeded user there is nothing to orphan, so the MVP does not enable it.

## The BoardData contract

This is the shape stored in `boards.data`. It matches `frontend/src/lib/kanban.ts` field for field, and Part 6 mirrors it in pydantic models. All three must stay in step.

```ts
type Card = {
  id: string;
  title: string;
  details: string;
};

type Column = {
  id: string;
  title: string;
  cardIds: string[];
};

type BoardData = {
  columns: Column[];
  cards: Record<string, Card>;
};
```

As JSON:

```json
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"] },
    { "id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"] }
  ],
  "cards": {
    "card-1": { "id": "card-1", "title": "Align roadmap themes", "details": "Draft quarterly themes." },
    "card-2": { "id": "card-2", "title": "Gather customer signals", "details": "Review support tags." },
    "card-3": { "id": "card-3", "title": "Prototype analytics view", "details": "Sketch the dashboard." }
  }
}
```

The structure is normalized inside the document: `columns` carries ordering as an array of card ids, and the card bodies live once each in the `cards` lookup. Field names are camelCase because they come from the frontend; the API does not rename them.

### Integrity rules

Validated on every write in Part 6, because a bad board from the AI or a buggy client must never be stored. A violation returns 422 and leaves the stored board untouched.

- Every id in a column's `cardIds` exists as a key in `cards`
- No card id appears in more than one column
- Every key in `cards` matches the `id` field of its own card
- Every card id in `cards` appears in exactly one column, so no card is orphaned
- Column ids are unique

Pydantic covers the types and required fields; these cross-references need explicit checks.

### Columns are fixed

The board keeps the five seeded columns. They can be renamed but not added or removed, so the UI never writes a different column set. The JSON itself imposes no limit, and neither does the schema.

## First run

Schema creation and seeding happen in the FastAPI lifespan on startup, so an empty or missing database file is not an error state.

1. Create the parent directory of `DB_PATH` if needed
2. Run the schema with `CREATE TABLE IF NOT EXISTS`, which makes startup idempotent
3. Insert user `user` with a hash of `password`, only if that username is absent
4. Insert that user's board seeded with the same five columns and eight cards the frontend demo used, only if the user has no board yet

Every step is conditional, so restarting never duplicates or overwrites data. Deleting `/data/pm.db` and restarting is a clean reset back to the seeded board, which is also how the tests get a fresh database each time.

## Migration path

If the app outgrows one JSON document per user, the move is mechanical because the document is already normalized internally:

```sql
CREATE TABLE columns (
  id       TEXT PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES boards(id),
  title    TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE cards (
  id        TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES columns(id),
  title     TEXT NOT NULL,
  details   TEXT NOT NULL,
  position  INTEGER NOT NULL
);
```

A backfill reads each `boards.data`, inserts one `columns` row per entry using its array index as `position`, and one `cards` row per id in `cardIds` using its index as `position`. No data is lost in either direction, since the JSON already carries every field the tables need.

Worth doing when any of these become true: more than one board per user, queries that need to search or aggregate across cards, per-card audit history, or concurrent editors who cannot tolerate whole-board replacement clobbering each other. None apply to the MVP.
