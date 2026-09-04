from httpx2 import AsyncClient, HTTPError

from app import config

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Generous because a board change makes the model reproduce the whole board.
# A measured add-a-card call took 92 seconds on the free tier; a question that
# returns no board takes about 6.
TIMEOUT = 180.0

# OpenRouter uses these to attribute traffic to an app on its dashboards.
APP_URL = "http://localhost:8000"
APP_TITLE = "Project Management MVP"


class AIError(RuntimeError):
    """Anything that stops us getting a usable reply out of OpenRouter."""


async def chat_completion(
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: dict | str | None = None,
) -> dict:
    """Send a chat completion to OpenRouter and return the reply message.

    The raw message dict is returned rather than just its text, so a caller
    forcing a tool call can read `tool_calls` off it.
    """
    if not config.OPENROUTER_API_KEY:
        raise AIError("OPENROUTER_API_KEY is not set")

    payload: dict = {"model": config.OPENROUTER_MODEL, "messages": messages}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice

    headers = {
        "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
        "HTTP-Referer": APP_URL,
        "X-Title": APP_TITLE,
    }

    try:
        async with AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(API_URL, json=payload, headers=headers)
    except HTTPError as exc:
        raise AIError(f"Could not reach OpenRouter: {exc}") from exc

    if response.status_code in (401, 403):
        raise AIError("OpenRouter rejected the API key, check OPENROUTER_API_KEY")
    if response.status_code == 429:
        raise AIError(
            "OpenRouter rate limit reached. The free tier allows 20 requests a "
            "minute and 50 a day"
        )
    if response.status_code != 200:
        raise AIError(f"OpenRouter returned {response.status_code}: {response.text}")

    # OpenRouter also reports upstream provider failures as a 200 with an error
    # body and no choices, so this is a real case rather than a paranoid check.
    choices = response.json().get("choices")
    if not choices:
        raise AIError(f"OpenRouter returned no choices: {response.text}")
    return choices[0]["message"]
