from fastapi.testclient import TestClient


def test_health_rejects_missing_auth(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", "x" * 32)
    monkeypatch.setenv("WHISPER_EXECUTABLE", "/missing/whisper-cli")
    monkeypatch.setenv("WHISPER_MODEL_PATH", "/missing/model.bin")
    monkeypatch.setenv("PYANNOTE_MODEL_PATH", "/missing/pyannote")
    monkeypatch.setenv("LM_STUDIO_MODEL", "local-model")
    from meeting_processor.app import app

    response = TestClient(app).get("/health")
    assert response.status_code == 401
    assert TestClient(app).post("/v1/cancel/test-request").status_code == 401


def test_health_reports_offline_pyannote_configuration(monkeypatch, tmp_path):
    model = tmp_path / "pyannote"
    model.mkdir()
    (model / "config.yaml").touch()
    (model / ".meeting-atlas-model.json").write_text(
        '{"revision":"test-revision"}', encoding="utf-8"
    )
    monkeypatch.setenv("SERVICE_TOKEN", "x" * 32)
    monkeypatch.setenv("WHISPER_EXECUTABLE", str(tmp_path / "whisper-cli"))
    monkeypatch.setenv("WHISPER_MODEL_PATH", str(tmp_path / "model.bin"))
    monkeypatch.setenv("PYANNOTE_MODEL_PATH", str(model))
    monkeypatch.setenv("LM_STUDIO_MODEL", "local-model")
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("HF_HUB_DISABLE_TELEMETRY", "1")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "1")
    monkeypatch.setenv("PYANNOTE_METRICS_ENABLED", "0")

    from meeting_processor import diarization
    from meeting_processor.app import app
    from meeting_processor.settings import get_settings

    monkeypatch.setattr(diarization, "_pyannote_package_ready", lambda: True)
    get_settings.cache_clear()
    response = TestClient(app).get(
        "/health", headers={"authorization": f"Bearer {'x' * 32}"}
    )
    get_settings.cache_clear()

    assert response.status_code == 200
    body = response.json()
    assert body["diarization_backend"] == "pyannote"
    assert body["diarization_model_revision"] == "test-revision"
    assert body["diarization_actual_device"] == "cpu"
    assert body["offline_flags"]["PYANNOTE_METRICS_ENABLED"] == "0"
