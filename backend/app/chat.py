import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app import ai, db
from app.auth import current_user
from app.schemas import BoardData, ChatRequest, ChatResponse

router = APIRouter(prefix="/api")

# Derived from the pydantic model so the tool and the validator cannot drift.
# `$defs` is hoisted to the parameters root because the generated `$ref`s are
# absolute to the top of the schema document they are sent in.
_BOARD_SCHEMA = BoardData.model_json_schema()
_BOARD_DEFS = _BOARD_SCHEMA.pop("$defs")
_BOARD_SCHEMA["description"] = "The complete replacement board, not just the changed parts."

TOOL = {
    "type": "function",
    "function": {
        "name": "respond_to_user",
        "description": "Reply to the user, and update the board if they asked for a change.",
        "parameters": {
            "type": "object",
            "properties": {
                "reply": {"type": "string", "description": "The message shown to the user."},
                "board": _BOARD_SCHEMA,
            },
            "required": ["reply"],
            "$defs": _BOARD_DEFS,
        },
    },
}

TOOL_CHOICE = {"type": "function", "function": {"name": "respond_to_user"}}

SYSTEM_PROMPT = """You help a user manage a Kanban board.

The board is JSON with two parts. `columns` is an ordered list of {id, title, cardIds}, where cardIds lists the cards in that column in order. `cards` maps a card id to {id, title, details}.

Only include the `board` argument when the user asks you to create, edit, move, or remove cards, or to rename a column. For anything else, answer in `reply` and leave `board` out.

When you do return a board, it must obey all of these or the change will be discarded:
- Include the whole board, with every column and every card, not just what changed.
- Keep the same five columns. Rename them if asked, but never add or remove one.
- Every id in a column's cardIds must exist in `cards`.
- Every card in `cards` must appear in exactly one column's cardIds.
- Each key in `cards` must equal that card's own `id`.
- Give a new card an id that is not already in use.

Keep `reply` short and say what you changed.

The user's current board:
"""


def _parse(message: dict) -> tuple[str, dict | None]:
    """Pull the reply and any board out of the forced tool call.

    Falls back to plain message content, since a model can ignore tool_choice.
    """
    for call in message.get("tool_calls") or []:
        try:
            arguments = json.loads(call["function"]["arguments"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        reply = arguments.get("reply")
        if reply:
            return reply, arguments.get("board")

    content = message.get("content")
    if content:
        return content, None
    raise ai.AIError("The model returned neither a usable tool call nor any content")


# Only the latest turns go to the model, so a long conversation cannot grow the
# prompt without limit. Enforced here so no client can bypass it.
MAX_HISTORY = 20

STALE_BOARD_REPLY = (
    "The board changed while I was working, so I did not apply my change. "
    "Ask again and I will work from the current board."
)


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, username: str = Depends(current_user)):
    board, version = db.get_board_and_version(username)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + json.dumps(board)},
        *(message.model_dump() for message in payload.history[-MAX_HISTORY:]),
        {"role": "user", "content": payload.message},
    ]

    try:
        message = await ai.chat_completion(messages, tools=[TOOL], tool_choice=TOOL_CHOICE)
        reply, new_board = _parse(message)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if new_board is None:
        return ChatResponse(reply=reply, board_updated=False)

    try:
        validated = BoardData(**new_board)
    except (ValidationError, TypeError):
        # A bad board is never stored. The user still gets the reply.
        return ChatResponse(reply=reply, board_updated=False)

    # The model's board was built from the snapshot read above. Writing it over
    # an edit the user made during the call would silently undo that edit.
    if not db.save_board(username, validated.model_dump(), expected_updated_at=version):
        return ChatResponse(reply=STALE_BOARD_REPLY, board_updated=False)
    return ChatResponse(reply=reply, board_updated=True)
