import pytest
from pydantic import SecretStr

from app.config import Settings
from app.services.google_credentials import (
    GoogleCredentialConfigurationError,
    service_account_credentials,
)


def test_service_account_json_must_be_valid_json(tmp_path) -> None:
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        google_service_account_json=SecretStr("not-json"),
    )

    with pytest.raises(GoogleCredentialConfigurationError, match="valid JSON"):
        service_account_credentials(settings)


def test_service_account_json_rejects_other_credential_types(tmp_path) -> None:
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        google_service_account_json=SecretStr('{"type":"external_account"}'),
    )

    with pytest.raises(GoogleCredentialConfigurationError, match="service account key"):
        service_account_credentials(settings)
