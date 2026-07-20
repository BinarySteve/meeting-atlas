from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_token: str = Field(min_length=32)
    service_host: str = "0.0.0.0"
    service_port: int = 8080
    service_max_upload_bytes: int = 2_147_483_648
    service_temp_dir: Path = Path("/srv/meeting-transcriber/tmp")
    subprocess_timeout_seconds: int = 21_600

    whisper_backend: Literal["rocm", "vulkan", "cpu"] = "vulkan"
    whisper_executable: Path
    whisper_model_path: Path
    whisper_model_name: Literal["large-v3-turbo", "large-v3"] = "large-v3-turbo"
    whisper_language: str = "auto"
    whisper_threads: int = 16
    whisper_vad_enabled: bool = False
    whisper_vad_model_path: Path | None = None

    diarization_backend: Literal["pyannote", "wespeaker"] = "pyannote"
    pyannote_model_path: Path | None = None
    pyannote_device: str = Field(default="cpu", pattern=r"^(cpu|cuda(?::\d+)?)$")
    pyannote_min_speakers: int = Field(default=1, ge=1, le=64)
    pyannote_max_speakers: int = Field(default=8, ge=1, le=64)

    wespeaker_model_path: Path | None = None
    wespeaker_device: str = Field(default="cpu", pattern=r"^(cpu|cuda(?::\d+)?)$")
    wespeaker_min_duration: float = Field(default=0.255, gt=0, le=10)
    wespeaker_window_seconds: float = Field(default=1.5, gt=0, le=30)
    wespeaker_period_seconds: float = Field(default=0.75, gt=0, le=30)
    wespeaker_batch_size: int = Field(default=32, ge=1, le=1024)

    lm_studio_url: str = "http://127.0.0.1:1234/v1"
    lm_studio_model: str
    lm_studio_timeout_seconds: int = 600

    @model_validator(mode="after")
    def require_absolute_whisper_timeline(self) -> "Settings":
        if self.whisper_vad_enabled:
            raise ValueError(
                "WHISPER_VAD_ENABLED=true compacts silence and is incompatible with "
                "synchronized transcript timestamps; set it to false"
            )
        if self.pyannote_min_speakers > self.pyannote_max_speakers:
            raise ValueError("PYANNOTE_MIN_SPEAKERS must not exceed PYANNOTE_MAX_SPEAKERS")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
