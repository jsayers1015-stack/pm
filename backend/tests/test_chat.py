import copy
import json

import httpx2

from app import chat, db
from app.schemas import TEXT_MAX
from app.seed import SEED_BOARD


def tool_response(**arguments) -> httpx2.Response:
    """A forced tool call carrying the given arguments, as OpenRouter returns it."""
    call = {
        "id": "call-1",
        "type": "function",
        "function": {"name": "respond_to_user", "arguments": json.dumps(arguments)},
    }
    return httpx2.Response(
        200, json={"choices": [{"message": {"content": None, "tool_calls": [call]}}]}
    )


def board_with_new_card() -> dict:
    board = copy.deepcopy(SEED_BOARD)
    board["cards"]["card-9"] = {"id": "card-9", "title": "Write the docs", "details": "All of them"}
    board["columns"][0]["cardIds"].append("card-9")
    return board


def board_with_moved_card() -> dict:
    """card-1 moved from Backlog to Done."""
    board = copy.deepcopy(SEED_BOARD)
    board["columns"][0]["cardIds"].remove("card-1")
    board["columns"][4]["cardIds"].append("card-1")
    return board


def test_a_question_returns_a_reply_and_leaves_the_board_alone(signed_in, openrouter):
    openrouter(lambda request: tool_response(reply="You have 8 cards."))

    response = signed_in.post("/api/chat", json={"message": "How many cards do I have?"})

    assert response.status_code == 200
    assert response.json() == {"reply": "You have 8 cards.", "board_updated": False}
    assert signed_in.get("/api/board").json() == SEED_BOARD


def test_a_returned_board_is_persisted(signed_in, openrouter):
    updated = board_with_new_card()
    openrouter(lambda request: tool_response(reply="Added it.", board=updated))

    response = signed_in.post("/api/chat", json={"message": "Add a card about docs"})

    assert response.json() == {"reply": "Added it.", "board_updated": True}
    assert signed_in.get("/api/board").json() == updated


def test_an_added_card_appears_in_the_stored_board(signed_in, openrouter):
    openrouter(lambda request: tool_response(reply="Done.", board=board_with_new_card()))

    signed_in.post("/api/chat", json={"message": "Add a card about docs"})

    stored = signed_in.get("/api/board").json()
    assert stored["cards"]["card-9"]["title"] == "Write the docs"
    assert "card-9" in stored["columns"][0]["cardIds"]


def test_a_moved_card_is_reflected_in_the_stored_card_ids(signed_in, openrouter):
    openrouter(lambda request: tool_response(reply="Moved.", board=board_with_moved_card()))

    signed_in.post("/api/chat", json={"message": "Move the roadmap card to Done"})

    board = signed_in.get("/api/board").json()
    columns = {column["id"]: column["cardIds"] for column in board["columns"]}
    assert "card-1" not in columns["col-backlog"]
    assert columns["col-done"] == ["card-7", "card-8", "card-1"]


def test_an_edit_made_during_the_call_is_not_overwritten(signed_in, openrouter):
    renamed = copy.deepcopy(SEED_BOARD)
    renamed["columns"][0]["title"] = "Renamed mid-call"

    def user_edits_then_ai_replies(request):
        # Stands in for a PUT /api/board landing while the model is thinking.
        db.save_board("user", renamed)
        return tool_response(reply="Added it.", board=board_with_new_card())

    openrouter(user_edits_then_ai_replies)

    response = signed_in.post("/api/chat", json={"message": "Add a card about docs"})

    assert response.json() == {"reply": chat.STALE_BOARD_REPLY, "board_updated": False}
    assert signed_in.get("/api/board").json() == renamed


def test_an_invalid_board_is_rejected_and_nothing_is_stored(signed_in, openrouter):
    broken = copy.deepcopy(SEED_BOARD)
    broken["columns"][0]["cardIds"].append("card-does-not-exist")
    openrouter(lambda request: tool_response(reply="Added it.", board=broken))

    response = signed_in.post("/api/chat", json={"message": "Add a card"})

    assert response.status_code == 200
    assert response.json() == {"reply": "Added it.", "board_updated": False}
    assert signed_in.get("/api/board").json() == SEED_BOARD


def test_a_board_that_is_not_an_object_is_rejected(signed_in, openrouter):
    openrouter(lambda request: tool_response(reply="Here.", board="the whole board"))

    response = signed_in.post("/api/chat", json={"message": "Add a card"})

    assert response.json() == {"reply": "Here.", "board_updated": False}
    assert signed_in.get("/api/board").json() == SEED_BOARD


def test_a_missing_tool_call_falls_back_to_message_content(signed_in, openrouter):
    openrouter(
        lambda request: httpx2.Response(
            200, json={"choices": [{"message": {"content": "Just talking."}}]}
        )
    )

    response = signed_in.post("/api/chat", json={"message": "Hello"})

    assert response.json() == {"reply": "Just talking.", "board_updated": False}


def test_unparseable_tool_arguments_fall_back_to_message_content(signed_in, openrouter):
    call = {
        "id": "call-1",
        "type": "function",
        "function": {"name": "respond_to_user", "arguments": "{not json"},
    }
    openrouter(
        lambda request: httpx2.Response(
            200,
            json={"choices": [{"message": {"content": "Fallback text", "tool_calls": [call]}}]},
        )
    )

    response = signed_in.post("/api/chat", json={"message": "Hello"})

    assert response.json() == {"reply": "Fallback text", "board_updated": False}


def test_an_empty_response_is_a_502(signed_in, openrouter):
    openrouter(lambda request: httpx2.Response(200, json={"choices": [{"message": {}}]}))

    response = signed_in.post("/api/chat", json={"message": "Hello"})

    assert response.status_code == 502


def test_an_openrouter_failure_is_a_502(signed_in, openrouter):
    openrouter(lambda request: httpx2.Response(429, json={"error": "slow down"}))

    response = signed_in.post("/api/chat", json={"message": "Hello"})

    assert response.status_code == 502
    assert "rate limit" in response.json()["detail"]


def test_the_request_carries_the_board_the_history_and_the_tool(signed_in, openrouter):
    sent = openrouter(lambda request: tool_response(reply="ok"))
    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
    ]

    signed_in.post("/api/chat", json={"message": "How many cards?", "history": history})

    body = json.loads(sent["request"].content)
    system, *rest = body["messages"]
    assert system["role"] == "system"
    assert json.dumps(SEED_BOARD) in system["content"]
    assert rest == [*history, {"role": "user", "content": "How many cards?"}]
    assert body["tool_choice"]["function"]["name"] == "respond_to_user"
    assert body["tools"][0]["function"]["name"] == "respond_to_user"


def test_only_the_latest_history_is_sent_to_the_model(signed_in, openrouter):
    sent = openrouter(lambda request: tool_response(reply="ok"))
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"turn {index}"}
        for index in range(chat.MAX_HISTORY + 10)
    ]

    signed_in.post("/api/chat", json={"message": "Latest", "history": history})

    _, *rest = json.loads(sent["request"].content)["messages"]
    assert rest == [*history[-chat.MAX_HISTORY:], {"role": "user", "content": "Latest"}]


def test_an_oversized_message_returns_422(signed_in, openrouter):
    openrouter(lambda request: tool_response(reply="never reached"))

    response = signed_in.post("/api/chat", json={"message": "x" * (TEXT_MAX + 1)})

    assert response.status_code == 422


def test_the_prompt_carries_the_current_board_not_the_seed(signed_in, openrouter):
    updated = board_with_new_card()
    signed_in.put("/api/board", json=updated)
    sent = openrouter(lambda request: tool_response(reply="ok"))

    signed_in.post("/api/chat", json={"message": "How many cards?"})

    system = json.loads(sent["request"].content)["messages"][0]
    assert json.dumps(updated) in system["content"]


def test_chat_without_a_session_returns_401(client):
    assert client.post("/api/chat", json={"message": "Hello"}).status_code == 401


def test_a_malformed_chat_body_returns_422(signed_in):
    assert signed_in.post("/api/chat", json={}).status_code == 422
