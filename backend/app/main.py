from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from app import auth, board, config, db

health_router = APIRouter(prefix="/api")


@health_router.get("/health")
def health():
    return {"status": "ok"}


# Claims every remaining /api path so unmatched API calls get a JSON 404
# instead of falling through to the static site. Must be included last.
fallback_router = APIRouter(prefix="/api")


@fallback_router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
def api_not_found(path: str):
    raise HTTPException(status_code=404, detail="Not found")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Project Management MVP", lifespan=lifespan)

app.include_router(health_router)
app.include_router(auth.router)
app.include_router(board.router)
app.include_router(fallback_router)

app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="static")
