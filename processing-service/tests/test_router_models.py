import pytest

from meeting_processor.router_models import llama_cpp_models_url, parse_llm_models


def test_parse_llm_models_uses_router_aliases_and_reports_loaded_state() -> None:
    models = parse_llm_models(
        {
            "data": [
                {
                    "id": "Embed",
                    "aliases": ["embed"],
                    "status": {"value": "loaded"},
                    "architecture": {
                        "input_modalities": ["text"],
                        "output_modalities": ["embedding"],
                    },
                },
                {
                    "id": "Second",
                    "aliases": ["local/second"],
                    "status": {"value": "unloaded"},
                    "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
                },
                {
                    "id": "First",
                    "aliases": ["local/first"],
                    "status": {"value": "loaded"},
                    "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
                },
            ]
        }
    )

    assert models == [
        {"id": "local/first", "display_name": "First", "loaded": True},
        {"id": "local/second", "display_name": "Second", "loaded": False},
    ]


def test_parse_llm_models_rejects_invalid_boundary() -> None:
    with pytest.raises(RuntimeError, match="invalid model list"):
        parse_llm_models({"data": [{"id": ""}]})


def test_llama_cpp_models_url_uses_openai_compatible_api() -> None:
    assert (
        llama_cpp_models_url("http://192.168.4.30:8081/v1")
        == "http://192.168.4.30:8081/v1/models"
    )
