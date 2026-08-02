from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
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
    google_service_account_json: SecretStr | None = None
    gemini_model: str = "gemini-2.5-flash"
    gcs_bucket: str | None = None
    speech_model: str = "long"
    speech_language: str = "en-US"
    max_source_duration_seconds: int = 3600
    max_source_bytes: int = 2_000_000_000
    ytdlp_cookies_file: Path | None = None
    worker_immediate: bool = Field(default=False, validation_alias="HUEY_IMMEDIATE")
    frontend_url: str = "http://localhost:5173"
    instagram_app_id: str | None = None
    instagram_app_secret: str | None = None
    instagram_redirect_uri: str = (
        "http://localhost:8000/api/platforms/instagram/callback"
    )
    instagram_api_version: str = "v23.0"
    public_base_url: str | None = None
    instagram_media_url_ttl_seconds: int = 3600
    instagram_processing_timeout_seconds: int = 600
    instagram_poll_interval_seconds: int = 5
    token_encryption_key: str | None = None
    web_dist_dir: Path | None = None

    @field_validator("ytdlp_cookies_file", mode="before")
    @classmethod
    def blank_cookie_path_is_unset(cls, value):
        # Path("") becomes Path("."), which makes yt-dlp try to open the
        # current directory as a cookie file. An empty env value means the
        # optional cookie file is not configured.
        if isinstance(value, str) and not value.strip():
            return None
        return value

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
    def batches_dir(self) -> Path:
        """Sequence Renders live here, apart from the per-Clip media."""
        return self.data_dir / "batches"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def instagram_missing_configuration(self) -> list[str]:
        values = {
            "INSTAGRAM_APP_ID": self.instagram_app_id,
            "INSTAGRAM_APP_SECRET": self.instagram_app_secret,
            "INSTAGRAM_REDIRECT_URI": self.instagram_redirect_uri,
            "TOKEN_ENCRYPTION_KEY": self.token_encryption_key,
        }
        return [name for name, value in values.items() if not value]

    @property
    def instagram_is_configured(self) -> bool:
        return not self.instagram_missing_configuration

    @property
    def external_base_url(self) -> str:
        """Public API origin used by Instagram to retrieve rendered media."""
        if self.public_base_url:
            return self.public_base_url.rstrip("/")
        redirect = urlsplit(self.instagram_redirect_uri)
        return f"{redirect.scheme}://{redirect.netloc}".rstrip("/")

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.batches_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings
