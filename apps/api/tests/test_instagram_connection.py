from datetime import datetime, timezone
from types import SimpleNamespace

from cryptography.fernet import Fernet
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from starlette.requests import Request

from app import main
from app.config import Settings
from app.database import Base
from app.models import PlatformAccount
from app.schemas import ConnectedAccountOut
from app.services import instagram


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code
        self.is_error = status_code >= 400

    def json(self) -> dict:
        return self.payload


class FakeInstagramClient:
    def __init__(self):
        self.get_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, url: str, data: dict):
        assert url == "https://api.instagram.com/oauth/access_token"
        assert data["code"] == "authorization-code"
        return FakeResponse(
            {
                "data": [
                    {
                        "access_token": "short-token",
                        "user_id": 123,
                        "permissions": (
                            "instagram_business_basic,"
                            "instagram_business_content_publish"
                        ),
                    }
                ]
            }
        )

    def get(self, url: str, params: dict, headers: dict | None = None):
        self.get_count += 1
        if self.get_count == 1:
            assert url == "https://graph.instagram.com/access_token"
            assert params["access_token"] == "short-token"
            return FakeResponse({"access_token": "long-token", "expires_in": 5_184_000})
        assert url.endswith("/v23.0/me")
        assert headers == {"Authorization": "Bearer long-token"}
        return FakeResponse({"id": "456", "username": "clipfarmer", "name": "Clip Farmer"})


def test_instagram_configuration_requires_secrets_and_encryption_key(tmp_path) -> None:
    settings = Settings(_env_file=None, data_dir=tmp_path / "data")
    assert settings.instagram_is_configured is False
    assert settings.instagram_missing_configuration == [
        "INSTAGRAM_APP_ID",
        "INSTAGRAM_APP_SECRET",
        "TOKEN_ENCRYPTION_KEY",
    ]


def test_instagram_token_is_encrypted_and_never_returned_by_schema() -> None:
    key = Fernet.generate_key().decode()
    encrypted = instagram.encrypt_token("secret-access-token", key)
    assert encrypted != "secret-access-token"
    assert instagram.decrypt_token(encrypted, key) == "secret-access-token"

    output = ConnectedAccountOut.model_validate(
        SimpleNamespace(
            id="account-1",
            platform="instagram",
            remote_user_id="456",
            username="clipfarmer",
            display_name="Clip Farmer",
            access_token_encrypted=encrypted,
            scopes="instagram_business_basic,instagram_business_content_publish",
            status="connected",
            token_expires_at=None,
            connected_at=datetime(2026, 7, 16),
            updated_at=datetime(2026, 7, 16),
        )
    )
    assert output.scopes == ["instagram_business_basic", "instagram_business_content_publish"]
    assert "access_token" not in output.model_dump()


def test_instagram_oauth_exchanges_for_long_lived_token_and_profile(monkeypatch) -> None:
    client = FakeInstagramClient()
    monkeypatch.setattr(instagram.httpx, "Client", lambda **_kwargs: client)
    settings = SimpleNamespace(
        instagram_app_id="app-id",
        instagram_app_secret="app-secret",
        instagram_redirect_uri="http://localhost:8000/api/platforms/instagram/callback",
        instagram_api_version="v23.0",
    )

    identity = instagram.exchange_authorization_code("authorization-code", settings)

    assert identity.remote_user_id == "456"
    assert identity.username == "clipfarmer"
    assert identity.display_name == "Clip Farmer"
    assert identity.access_token == "long-token"
    assert identity.expires_at is not None


def test_instagram_callback_stores_encrypted_account_and_redirects(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'instagram.db'}")
    Base.metadata.create_all(engine)
    session = Session(engine)
    key = Fernet.generate_key().decode()
    callback_settings = SimpleNamespace(
        instagram_app_secret="app-secret",
        token_encryption_key=key,
        frontend_url="http://localhost:5173",
    )
    monkeypatch.setattr(main, "settings", callback_settings)
    monkeypatch.setattr(
        main,
        "exchange_authorization_code",
        lambda _code, _settings: instagram.InstagramIdentity(
            remote_user_id="456",
            username="clipfarmer",
            display_name="Clip Farmer",
            access_token="long-token",
            expires_at=datetime(2026, 9, 14, tzinfo=timezone.utc),
        ),
    )
    state = main._encode_oauth_state()
    request = Request(
        {
            "type": "http",
            "headers": [(b"cookie", f"{main.INSTAGRAM_STATE_COOKIE}={state}".encode())],
        }
    )

    response = main.instagram_callback(
        request=request,
        code="authorization-code",
        state=state,
        error=None,
        session=session,
    )

    account = session.scalar(select(PlatformAccount))
    assert response.headers["location"] == "http://localhost:5173/settings?instagram=connected"
    assert account is not None
    assert account.username == "clipfarmer"
    assert account.access_token_encrypted != "long-token"
    assert instagram.decrypt_token(account.access_token_encrypted, key) == "long-token"
    session.close()
