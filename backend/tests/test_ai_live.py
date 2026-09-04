"""Opt-in checks against the real OpenRouter API.

Excluded from the default suite by the `-m 'not live'` default in pyproject.
Run them with `scripts/test-ai.ps1` or `scripts/test-ai.sh`.
"""

import json

import pytest

from app import ai, config

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not config.OPENROUTER_API_KEY, reason="OPENROUTER_API_KEY is not set"),
]


async def test_the_model_can_answer_two_plus_two():
    message = await ai.chat_completion(
        [{"role": "user", "content": "What is 2+2? Reply with just the number."}]
    )

    print(f"\nmodel: {config.OPENROUTER_MODEL}\nreply: {message['content']!r}")
    assert "4" in message["content"]


async def test_the_model_honours_a_forced_tool_call():
    """Part 9 depends on every reply arriving as a forced tool call, so prove
    the model does that before building on it."""
    tool = {
        "type": "function",
        "function": {
            "name": "respond_to_user",
            "description": "Reply to the user.",
            "parameters": {
                "type": "object",
                "properties": {"reply": {"type": "string", "description": "The answer."}},
                "required": ["reply"],
            },
        },
    }

    message = await ai.chat_completion(
        [{"role": "user", "content": "What is the capital of France?"}],
        tools=[tool],
        tool_choice={"type": "function", "function": {"name": "respond_to_user"}},
    )

    call = message["tool_calls"][0]
    arguments = json.loads(call["function"]["arguments"])
    print(f"\ntool call: {call['function']['name']} {arguments}")

    assert call["function"]["name"] == "respond_to_user"
    assert "paris" in arguments["reply"].lower()
