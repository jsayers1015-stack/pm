from pydantic import BaseModel, model_validator


class LoginRequest(BaseModel):
    username: str
    password: str


class Card(BaseModel):
    id: str
    title: str
    details: str


class Column(BaseModel):
    id: str
    title: str
    cardIds: list[str]


class BoardData(BaseModel):
    """The whole Kanban board. Field names are camelCase to match the frontend.

    The validator enforces the cross-reference rules in docs/DATABASE.md, which
    types alone cannot express. Raising here means a bad board is rejected with a
    422 before it can be stored, whether it came from the browser or the AI.
    """

    columns: list[Column]
    cards: dict[str, Card]

    @model_validator(mode="after")
    def check_integrity(self):
        column_ids = [column.id for column in self.columns]
        if len(set(column_ids)) != len(column_ids):
            raise ValueError("duplicate column ids")

        for key, card in self.cards.items():
            if key != card.id:
                raise ValueError(f"cards key {key!r} does not match card id {card.id!r}")

        placed: set[str] = set()
        for column in self.columns:
            for card_id in column.cardIds:
                if card_id not in self.cards:
                    raise ValueError(
                        f"column {column.id!r} references unknown card {card_id!r}"
                    )
                if card_id in placed:
                    raise ValueError(f"card {card_id!r} appears in more than one column")
                placed.add(card_id)

        orphans = sorted(set(self.cards) - placed)
        if orphans:
            raise ValueError(f"cards in no column: {orphans}")

        return self
