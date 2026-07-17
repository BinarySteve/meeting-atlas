from fastapi.testclient import TestClient


def test_health_rejects_missing_auth(monkeypatch):
    monkeypatch.setenv("SERVICE_TOKEN", "x" * 32)
    monkeypatch.setenv("WHISPER_EXECUTABLE", "/missing/whisper-cli")
    monkeypatch.setenv("WHISPER_MODEL_PATH", "/missing/model.bin")
    monkeypatch.setenv("WESPEAKER_MODEL_PATH", "/missing/wespeaker")
    monkeypatch.setenv("LM_STUDIO_MODEL", "local-model")
    from meeting_processor.app import app

    response = TestClient(app).get("/health")
    assert response.status_code == 401
    assert TestClient(app).post("/v1/cancel/test-request").status_code == 401
