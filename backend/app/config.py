import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DB_PATH = Path(os.getenv("DB_PATH", BASE_DIR / "data" / "pm.db"))
STATIC_DIR = Path(os.getenv("STATIC_DIR", BASE_DIR / "static"))
SECRET_KEY = os.getenv("SECRET_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free")


def secret_key() -> str:
    """Signing key for session cookies.

    Generated and stored next to the database on first use, so sessions survive
    a restart without requiring the user to set anything.
    """
    if SECRET_KEY:
        return SECRET_KEY

    path = DB_PATH.parent / "secret_key"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(32))
    return path.read_text()
