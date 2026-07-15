from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", PROJECT_ROOT / "apps/api/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Clip Farm"
    api_prefix: str = "/api"
    data_dir: Path = PROJECT_ROOT / "data"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    google_cloud_project: str | None = None
    google_cloud_location: str = "global"
    gcs_bucket: str | None = None
    speech_model: str = "long"
    speech_language: str = "en-US"
    max_source_duration_seconds: int = 3600
    max_source_bytes: int = 2_000_000_000
    ytdlp_cookies_file: Path | None = None
    worker_immediate: bool = Field(default=False, validation_alias="HUEY_IMMEDIATE")

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'app.db'}"

    @property
    def queue_path(self) -> Path:
        return self.data_dir / "queue.db"

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings

