import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime

from app import config
from app.seed import SEED_BOARD

SCHEMA = """
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
"""

DEFAULT_USERNAME = "user"
DEFAULT_PASSWORD = "password"

PBKDF2_ROUNDS = 200_000


@contextmanager
def connect():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS
    )
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt, _ = stored.split("$", 1)
    return secrets.compare_digest(hash_password(password, salt), stored)


def _ensure_board(conn: sqlite3.Connection, user_id: int) -> str:
    row = conn.execute(
        "SELECT data FROM boards WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is not None:
        return row["data"]

    data = json.dumps(SEED_BOARD)
    conn.execute(
        "INSERT INTO boards (user_id, data, updated_at) VALUES (?, ?, ?)",
        (user_id, data, _now()),
    )
    return data


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        row = conn.execute(
            "SELECT id FROM users WHERE username = ?", (DEFAULT_USERNAME,)
        ).fetchone()
        if row is None:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (DEFAULT_USERNAME, hash_password(DEFAULT_PASSWORD)),
            )
            user_id = cursor.lastrowid
        else:
            user_id = row["id"]
        _ensure_board(conn, user_id)


def get_user(username: str) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()


def get_board(username: str) -> dict:
    """The user's board, seeded on first access so any user gets one."""
    with connect() as conn:
        user = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        return json.loads(_ensure_board(conn, user["id"]))


def get_board_and_version(username: str) -> tuple[dict, str]:
    """The board and its updated_at, read together so the pair is consistent.

    Pass the version back to save_board to write only if nothing changed since.
    """
    with connect() as conn:
        user = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        _ensure_board(conn, user["id"])
        row = conn.execute(
            "SELECT data, updated_at FROM boards WHERE user_id = ?", (user["id"],)
        ).fetchone()
        return json.loads(row["data"]), row["updated_at"]


def save_board(username: str, board: dict, expected_updated_at: str | None = None) -> bool:
    """Replace the board. With expected_updated_at, only if the stored board is
    still that version. Returns whether the board was written."""
    with connect() as conn:
        user = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        _ensure_board(conn, user["id"])
        sql = "UPDATE boards SET data = ?, updated_at = ? WHERE user_id = ?"
        params = [json.dumps(board), _now(), user["id"]]
        if expected_updated_at is not None:
            sql += " AND updated_at = ?"
            params.append(expected_updated_at)
        return conn.execute(sql, params).rowcount == 1


def board_updated_at(username: str) -> str:
    with connect() as conn:
        row = conn.execute(
            "SELECT b.updated_at FROM boards b"
            " JOIN users u ON u.id = b.user_id WHERE u.username = ?",
            (username,),
        ).fetchone()
        return row["updated_at"]
