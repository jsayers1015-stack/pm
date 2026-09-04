"""Opt-in end-to-end check of /api/chat against the real model.

Excluded from the default suite. Run with `scripts/test-ai.ps1`.
"""

import pytest

from app import config
from app.seed import SEED_BOARD

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not config.OPENROUTER_API_KEY, reason="OPENROUTER_API_KEY is not set"),
]


def test_the_model_can_add_a_card_to_the_real_board(signed_in):
    response = signed_in.post(
        "/api/chat",
        json={"message": "Add a card titled 'Book the venue' to the Backlog column."},
    )
    assert response.status_code == 200

    body = response.json()
    print(f"\nreply: {body['reply']!r}\nboard_updated: {body['board_updated']}")
    assert body["board_updated"] is True

    board = signed_in.get("/api/board").json()
    titles = {card["title"] for card in board["cards"].values()}
    print(f"titles: {sorted(titles)}")

    added = [card for card in board["cards"].values() if "venue" in card["title"].lower()]
    assert added, f"no card mentioning the venue was added, got {sorted(titles)}"

    backlog = next(column for column in board["columns"] if column["id"] == "col-backlog")
    assert added[0]["id"] in backlog["cardIds"]
    assert len(board["cards"]) == len(SEED_BOARD["cards"]) + 1


def test_the_model_answers_a_question_without_touching_the_board(signed_in):
    response = signed_in.post("/api/chat", json={"message": "How many columns does my board have?"})

    body = response.json()
    print(f"\nreply: {body['reply']!r}\nboard_updated: {body['board_updated']}")
    assert body["board_updated"] is False
    assert signed_in.get("/api/board").json() == SEED_BOARD
