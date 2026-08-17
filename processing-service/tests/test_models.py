import pytest

from meeting_processor.models import lm_studio_models_url, parse_llm_models


def test_parse_llm_models_filters_embeddings_and_reports_loaded_state() -> None:
    models = parse_llm_models(
        {
            "models": [
                {
                    "type": "embedding",
                    "key": "embed",
                    "display_name": "Embed",
                    "loaded_instances": [{"id": "embed"}],
                },
                {
                    "type": "llm",
                    "key": "local/second",
                    "display_name": "Second",
                    "loaded_instances": [],
                },
                {
                    "type": "llm",
                    "key": "local/first",
                    "display_name": "First",
                    "loaded_instances": [{"id": "first-loaded"}],
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
        parse_llm_models({"models": [{"type": "llm", "key": ""}]})


def test_lm_studio_models_url_uses_native_local_api() -> None:
    assert (
        lm_studio_models_url("http://192.168.4.30:1234/v1")
        == "http://192.168.4.30:1234/api/v1/models"
    )
