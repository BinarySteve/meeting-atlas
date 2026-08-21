import json
from typing import Any

import httpx

from .settings import get_settings


async def structured_completion(
    system: str,
    user: str,
    schema: dict[str, Any],
    model: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    selected_model = model or settings.llama_cpp_model
    payload = {
        "model": selected_model,
        "temperature": settings.llama_cpp_temperature,
        "top_p": settings.llama_cpp_top_p,
        "top_k": settings.llama_cpp_top_k,
        "min_p": settings.llama_cpp_min_p,
        "repeat_penalty": settings.llama_cpp_repeat_penalty,
        "max_tokens": settings.llama_cpp_max_tokens,
        "reasoning_effort": "none",
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {
            "type": "json_schema",
            "schema": schema,
        },
    }
    async with httpx.AsyncClient(timeout=settings.llama_cpp_timeout_seconds) as client:
        response = await client.post(
            f"{settings.llama_cpp_url.rstrip('/')}/chat/completions", json=payload
        )
        schema_fallback = False
        if response.status_code == 400:
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
                f"{settings.llama_cpp_url.rstrip('/')}/chat/completions", json=payload
            )
            schema_fallback = True
        if response.is_error:
            detail = response.text[:1000].replace("\n", " ")
            raise RuntimeError(f"llama.cpp router HTTP {response.status_code}: {detail}")
    body = response.json()
    content = body["choices"][0]["message"]["content"]
    return {
        "model": selected_model,
        "content": json.loads(content),
        "usage": body.get("usage"),
        "schema_fallback": schema_fallback,
    }
