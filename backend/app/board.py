from fastapi import APIRouter, Depends

from app import db
from app.auth import current_user
from app.schemas import BoardData

router = APIRouter(prefix="/api")


@router.get("/board", response_model=BoardData)
def read_board(username: str = Depends(current_user)):
    return db.get_board(username)


@router.put("/board", response_model=BoardData)
def replace_board(board: BoardData, username: str = Depends(current_user)):
    db.save_board(username, board.model_dump())
    return board
