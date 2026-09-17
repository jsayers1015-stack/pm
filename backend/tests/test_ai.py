import json

import httpx2
import pytest

from app import ai, config


def reply(content: str) -> httpx2.Response:
    return httpx2.Response(200, json={"choices": [{"message": {"content": content}}]})


async def test_a_normal_response_is_parsed(openrouter):
    openrouter(lambda request: reply("4"))

    message = await ai.chat_completion([{"role": "user", "content": "what is 2+2"}])

    assert message["content"] == "4"


async def test_the_request_carries_the_key_model_and_attribution(openrouter, monkeypatch):
    monkeypatch.setattr(config, "OPENROUTER_MODEL", "test/model")
    sent = openrouter(lambda request: reply("hello"))

    await ai.chat_completion([{"role": "user", "content": "hi"}])

    request = sent["request"]
    assert str(request.url) == ai.API_URL
    assert request.headers["authorization"] == "Bearer test-key"
    assert request.headers["http-referer"] == ai.APP_URL
    assert request.headers["x-title"] == ai.APP_TITLE

    body = json.loads(request.content)
    assert body["model"] == "test/model"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert "tools" not in body


async def test_tools_and_tool_choice_are_forwarded(openrouter):
    sent = openrouter(lambda request: reply("ok"))
    tools = [{"type": "function", "function": {"name": "respond_to_user"}}]
    choice = {"type": "function", "function": {"name": "respond_to_user"}}

    await ai.chat_completion([{"role": "user", "content": "hi"}], tools=tools, tool_choice=choice)

    body = json.loads(sent["request"].content)
    assert body["tools"] == tools
    assert body["tool_choice"] == choice


async def test_a_tool_call_response_is_returned_intact(openrouter):
    tool_call = {
        "id": "call-1",
        "type": "function",
        "function": {"name": "respond_to_user", "arguments": '{"reply": "done"}'},
    }
    openrouter(
        lambda request: httpx2.Response(
            200, json={"choices": [{"message": {"content": None, "tool_calls": [tool_call]}}]}
        )
    )

    message = await ai.chat_completion([{"role": "user", "content": "hi"}])

    assert message["tool_calls"] == [tool_call]


async def test_a_missing_key_is_a_clear_error(openrouter, monkeypatch):
    openrouter(lambda request: reply("never reached"))
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "")

    with pytest.raises(ai.AIError, match="OPENROUTER_API_KEY is not set"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])


async def test_a_rejected_key_is_a_clear_error(openrouter):
    openrouter(lambda request: httpx2.Response(401, json={"error": "nope"}))

    with pytest.raises(ai.AIError, match="rejected the API key"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])


async def test_a_rate_limit_is_a_clear_error(openrouter):
    openrouter(lambda request: httpx2.Response(429, json={"error": "slow down"}))

    with pytest.raises(ai.AIError, match="rate limit"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])


async def test_a_timeout_is_a_clean_error(openrouter):
    def timeout(request):
        raise httpx2.TimeoutException("timed out", request=request)

    openrouter(timeout)

    with pytest.raises(ai.AIError, match="Could not reach OpenRouter"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])


async def test_a_200_with_no_choices_is_an_error(openrouter):
    openrouter(lambda request: httpx2.Response(200, json={"error": {"message": "upstream"}}))

    with pytest.raises(ai.AIError, match="no choices"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])


async def test_a_200_with_a_body_that_is_not_json_is_an_error(openrouter):
    openrouter(lambda request: httpx2.Response(200, text="<html>Bad gateway</html>"))

    with pytest.raises(ai.AIError, match="not JSON"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])


async def test_a_choice_with_no_message_is_an_error(openrouter):
    openrouter(lambda request: httpx2.Response(200, json={"choices": [{"finish_reason": "error"}]}))

    with pytest.raises(ai.AIError, match="no message"):
        await ai.chat_completion([{"role": "user", "content": "hi"}])
