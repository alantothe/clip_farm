import json

from google.auth.credentials import Credentials
from google.oauth2 import service_account

from app.config import Settings


CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class GoogleCredentialConfigurationError(RuntimeError):
    pass


def service_account_credentials(settings: Settings) -> Credentials | None:
    """Load an explicitly configured service account without writing it to disk."""
    secret = settings.google_service_account_json
    if secret is None or not secret.get_secret_value().strip():
        return None

    try:
        info = json.loads(secret.get_secret_value())
    except json.JSONDecodeError as exc:
        raise GoogleCredentialConfigurationError(
            "GOOGLE_SERVICE_ACCOUNT_JSON must contain valid JSON"
        ) from exc

    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise GoogleCredentialConfigurationError(
            "GOOGLE_SERVICE_ACCOUNT_JSON must contain a service account key"
        )

    try:
        return service_account.Credentials.from_service_account_info(
            info,
            scopes=[CLOUD_PLATFORM_SCOPE],
        )
    except (KeyError, ValueError) as exc:
        raise GoogleCredentialConfigurationError(
            "GOOGLE_SERVICE_ACCOUNT_JSON is missing required service account fields"
        ) from exc
