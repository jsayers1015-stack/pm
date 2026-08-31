from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app import config, db
from app.schemas import LoginRequest

COOKIE_NAME = "session"
SESSION_MAX_AGE = 7 * 24 * 60 * 60

router = APIRouter(prefix="/api")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(config.secret_key(), salt="pm-session")


def current_user(request: Request) -> str:
    """Signed-in username, or 401. The session is a signed cookie, so there is
    no server-side session store to survive restarts."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    try:
        username = _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Invalid session")

    # A correctly signed cookie can still name a user who no longer exists, for
    # instance after the database is reset with SECRET_KEY pinned in the
    # environment. Without this the board queries would fail with a 500.
    if db.get_user(username) is None:
        raise HTTPException(status_code=401, detail="Unknown user")
    return username


@router.post("/login")
def login(payload: LoginRequest, response: Response):
    user = db.get_user(payload.username)
    if user is None or not db.verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    response.set_cookie(
        COOKIE_NAME,
        _serializer().dumps(payload.username),
        httponly=True,
        samesite="lax",
        max_age=SESSION_MAX_AGE,
        path="/",
    )
    return {"username": payload.username}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(username: str = Depends(current_user)):
    return {"username": username}
