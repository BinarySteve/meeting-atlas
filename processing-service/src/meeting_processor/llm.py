import json
from typing import Any

import httpx

from .settings import get_settings


async def structured_completion(system: str, user: str, schema: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    payload = {
        "model": settings.lm_studio_model,
        "temperature": 0,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "meeting_output", "strict": True, "schema": schema},
        },
    }
    async with httpx.AsyncClient(timeout=settings.lm_studio_timeout_seconds) as client:
        response = await client.post(
            f"{settings.lm_studio_url.rstrip('/')}/chat/completions", json=payload
        )
        schema_fallback = False
        if response.status_code == 400:
            # Some local LM Studio runtimes/models reject a supplied schema.
            # Retry once in text mode; the prompt still requires JSON and the
            # Windows application validates the parsed result with Zod.
            payload["response_format"] = {"type": "text"}
            payload["messages"] = [
                {
                    "role": "system",
                    "content": (
                        f"{system}\nReturn only one JSON object matching this exact JSON Schema: "
                        f"{json.dumps(schema, separators=(',', ':'))}"
                    ),
                },
                {"role": "user", "content": user},
            ]
            response = await client.post(
                f"{settings.lm_studio_url.rstrip('/')}/chat/completions", json=payload
            )
            schema_fallback = True
        if response.is_error:
            detail = response.text[:1000].replace("\n", " ")
            raise RuntimeError(f"LM Studio HTTP {response.status_code}: {detail}")
    body = response.json()
    content = body["choices"][0]["message"]["content"]
    return {
        "model": settings.lm_studio_model,
        "content": json.loads(content),
        "usage": body.get("usage"),
        "schema_fallback": schema_fallback,
    }
