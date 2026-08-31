import json

from app import config, db
from app.seed import SEED_BOARD


def valid_board():
    return {
        "columns": [
            {"id": "col-a", "title": "A", "cardIds": ["card-1", "card-2"]},
            {"id": "col-b", "title": "B", "cardIds": []},
        ],
        "cards": {
            "card-1": {"id": "card-1", "title": "One", "details": "First"},
            "card-2": {"id": "card-2", "title": "Two", "details": "Second"},
        },
    }


def test_get_board_returns_the_seeded_board(signed_in):
    response = signed_in.get("/api/board")
    assert response.status_code == 200

    board = response.json()
    assert len(board["columns"]) == 5
    assert len(board["cards"]) == 8
    assert [column["id"] for column in board["columns"]] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]


def test_seeded_board_matches_the_seed_module(signed_in):
    assert signed_in.get("/api/board").json() == SEED_BOARD


def test_get_board_without_session_returns_401(client):
    assert client.get("/api/board").status_code == 401


def test_put_board_without_session_returns_401(client):
    assert client.put("/api/board", json=valid_board()).status_code == 401


def test_put_then_get_round_trips_identically(signed_in):
    board = valid_board()
    put = signed_in.put("/api/board", json=board)
    assert put.status_code == 200

    assert signed_in.get("/api/board").json() == board


def test_put_persists_across_a_new_request(signed_in):
    board = valid_board()
    board["cards"]["card-1"]["title"] = "Renamed by test"
    signed_in.put("/api/board", json=board)

    assert signed_in.get("/api/board").json()["cards"]["card-1"]["title"] == (
        "Renamed by test"
    )


def test_put_updates_the_timestamp(signed_in):
    before = db.board_updated_at("user")
    signed_in.put("/api/board", json=valid_board())
    assert db.board_updated_at("user") != before


def test_database_file_is_created_when_missing(signed_in):
    assert config.DB_PATH.exists()


def test_two_users_get_separate_boards(signed_in):
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            ("second", db.hash_password("second-password")),
        )

    mine = valid_board()
    mine["cards"]["card-1"]["title"] = "Belongs to user"
    signed_in.put("/api/board", json=mine)

    signed_in.post("/api/logout")
    signed_in.post(
        "/api/login", json={"username": "second", "password": "second-password"}
    )

    theirs = signed_in.get("/api/board").json()
    assert theirs == SEED_BOARD

    theirs["columns"][0]["title"] = "Their column"
    signed_in.put("/api/board", json=theirs)

    signed_in.post("/api/logout")
    signed_in.post("/api/login", json={"username": "user", "password": "password"})
    assert signed_in.get("/api/board").json()["cards"]["card-1"]["title"] == (
        "Belongs to user"
    )


class TestValidation:
    """Every rule in docs/DATABASE.md must be rejected with a 422."""

    def test_malformed_body_is_rejected(self, signed_in):
        assert signed_in.put("/api/board", json={"columns": []}).status_code == 422

    def test_wrong_field_type_is_rejected(self, signed_in):
        board = valid_board()
        board["columns"][0]["cardIds"] = "not-a-list"
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_missing_card_field_is_rejected(self, signed_in):
        board = valid_board()
        del board["cards"]["card-1"]["details"]
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_dangling_card_id_is_rejected(self, signed_in):
        board = valid_board()
        board["columns"][0]["cardIds"].append("card-missing")
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_card_in_two_columns_is_rejected(self, signed_in):
        board = valid_board()
        board["columns"][1]["cardIds"].append("card-1")
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_orphaned_card_is_rejected(self, signed_in):
        board = valid_board()
        board["columns"][0]["cardIds"].remove("card-2")
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_cards_key_mismatch_is_rejected(self, signed_in):
        board = valid_board()
        board["cards"]["card-1"]["id"] = "card-other"
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_duplicate_column_ids_are_rejected(self, signed_in):
        board = valid_board()
        board["columns"][1]["id"] = "col-a"
        assert signed_in.put("/api/board", json=board).status_code == 422

    def test_rejected_put_leaves_the_stored_board_untouched(self, signed_in):
        before = signed_in.get("/api/board").json()
        raw_before = json.dumps(before, sort_keys=True)

        broken = valid_board()
        broken["columns"][0]["cardIds"].append("card-missing")
        assert signed_in.put("/api/board", json=broken).status_code == 422

        after = signed_in.get("/api/board").json()
        assert json.dumps(after, sort_keys=True) == raw_before
