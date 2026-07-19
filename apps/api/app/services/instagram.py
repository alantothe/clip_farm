from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac

from cryptography.fernet import Fernet, InvalidToken
import httpx


INSTAGRAM_SCOPES = (
    "instagram_business_basic",
    "instagram_business_content_publish",
)


class InstagramConnectionError(RuntimeError):
    """A safe, user-facing Instagram connection failure."""


@dataclass(frozen=True)
class InstagramIdentity:
    remote_user_id: str
    username: str
    display_name: str | None
    access_token: str
    expires_at: datetime | None


@dataclass(frozen=True)
class InstagramToken:
    access_token: str
    expires_at: datetime | None


def encrypt_token(token: str, key: str) -> str:
    try:
        return Fernet(key.encode()).encrypt(token.encode()).decode()
    except (TypeError, ValueError, InvalidToken) as exc:
        raise InstagramConnectionError("TOKEN_ENCRYPTION_KEY is not a valid Fernet key") from exc


def decrypt_token(token: str, key: str) -> str:
    try:
        return Fernet(key.encode()).decrypt(token.encode()).decode()
    except (TypeError, ValueError, InvalidToken) as exc:
        raise InstagramConnectionError("The stored Instagram credential cannot be decrypted") from exc


def _json_or_error(response: httpx.Response, stage: str) -> dict:
    try:
        payload = response.json()
    except ValueError as exc:
        raise InstagramConnectionError(f"Instagram returned an invalid response while {stage}") from exc
    if not isinstance(payload, dict):
        raise InstagramConnectionError(f"Instagram returned an invalid response while {stage}")
    if response.is_error or payload.get("error") or payload.get("error_type"):
        error = payload.get("error")
        code = error.get("code") if isinstance(error, dict) else payload.get("error_type")
        suffix = f" ({code})" if code else ""
        raise InstagramConnectionError(f"Instagram rejected the request while {stage}{suffix}")
    return payload


def _token_result(payload: dict) -> dict:
    """Accept both current and legacy Instagram token response shapes."""
    results = payload.get("data")
    if isinstance(results, list) and results and isinstance(results[0], dict):
        return results[0]
    return payload


def _graph_url(settings, path: str) -> str:
    return f"https://graph.instagram.com/{settings.instagram_api_version}/{path.lstrip('/')}"


def _bearer(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def exchange_authorization_code(code: str, settings) -> InstagramIdentity:
    try:
        with httpx.Client(timeout=20.0) as client:
            token_response = client.post(
                "https://api.instagram.com/oauth/access_token",
                data={
                    "client_id": settings.instagram_app_id,
                    "client_secret": settings.instagram_app_secret,
                    "grant_type": "authorization_code",
                    "redirect_uri": settings.instagram_redirect_uri,
                    "code": code,
                },
            )
            short_token_response = _json_or_error(token_response, "exchanging the login code")
            short_token_data = _token_result(short_token_response)
            short_token = short_token_data.get("access_token")
            if not short_token:
                raise InstagramConnectionError("Instagram did not return an access token")

            long_token_response = client.get(
                "https://graph.instagram.com/access_token",
                params={
                    "grant_type": "ig_exchange_token",
                    "client_secret": settings.instagram_app_secret,
                    "access_token": short_token,
                },
            )
            long_token_data = _json_or_error(long_token_response, "creating a long-lived login")
            access_token = long_token_data.get("access_token")
            if not access_token:
                raise InstagramConnectionError("Instagram did not return a long-lived access token")

            profile_url = f"https://graph.instagram.com/{settings.instagram_api_version}/me"
            profile_response = client.get(
                profile_url,
                params={"fields": "id,user_id,username,name"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if profile_response.status_code == 400:
                profile_response = client.get(
                    profile_url,
                    params={"fields": "id,username"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            profile = _json_or_error(profile_response, "reading the connected profile")
    except httpx.HTTPError as exc:
        raise InstagramConnectionError("Instagram could not be reached during login") from exc

    remote_user_id = str(
        profile.get("user_id") or profile.get("id") or short_token_data.get("user_id") or ""
    )
    username = str(profile.get("username") or "")
    if not remote_user_id or not username:
        raise InstagramConnectionError("Instagram did not return the connected account identity")
    expires_in = long_token_data.get("expires_in")
    expires_at = None
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    return InstagramIdentity(
        remote_user_id=remote_user_id,
        username=username,
        display_name=profile.get("name"),
        access_token=access_token,
        expires_at=expires_at,
    )


def refresh_long_lived_token(access_token: str, settings) -> InstagramToken:
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                "https://graph.instagram.com/refresh_access_token",
                params={
                    "grant_type": "ig_refresh_token",
                    "access_token": access_token,
                },
            )
            payload = _json_or_error(response, "refreshing the connected login")
    except httpx.HTTPError as exc:
        raise InstagramConnectionError("Instagram could not be reached while refreshing the login") from exc
    token = payload.get("access_token")
    if not token:
        raise InstagramConnectionError("Instagram did not return a refreshed access token")
    expires_in = payload.get("expires_in")
    expires_at = None
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    return InstagramToken(access_token=str(token), expires_at=expires_at)


def create_reel_container(
    *,
    remote_user_id: str,
    access_token: str,
    video_url: str,
    caption: str,
    share_to_feed: bool,
    settings,
) -> str:
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                _graph_url(settings, f"{remote_user_id}/media"),
                data={
                    "media_type": "REELS",
                    "video_url": video_url,
                    "caption": caption,
                    "share_to_feed": str(share_to_feed).lower(),
                },
                headers=_bearer(access_token),
            )
            payload = _json_or_error(response, "creating the Reel upload")
    except httpx.HTTPError as exc:
        raise InstagramConnectionError("Instagram could not be reached while creating the Reel") from exc
    container_id = payload.get("id")
    if not container_id:
        raise InstagramConnectionError("Instagram did not return a Reel container ID")
    return str(container_id)


def get_container_status(container_id: str, access_token: str, settings) -> tuple[str, str | None]:
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                _graph_url(settings, container_id),
                params={"fields": "status_code,status"},
                headers=_bearer(access_token),
            )
            payload = _json_or_error(response, "checking the Reel upload")
    except httpx.HTTPError as exc:
        raise InstagramConnectionError("Instagram could not be reached while checking the Reel") from exc
    return str(payload.get("status_code") or "").upper(), payload.get("status")


def publish_reel(
    *, remote_user_id: str, container_id: str, access_token: str, settings
) -> str:
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                _graph_url(settings, f"{remote_user_id}/media_publish"),
                data={"creation_id": container_id},
                headers=_bearer(access_token),
            )
            payload = _json_or_error(response, "publishing the Reel")
    except httpx.HTTPError as exc:
        raise InstagramConnectionError("Instagram could not be reached while publishing the Reel") from exc
    media_id = payload.get("id")
    if not media_id:
        raise InstagramConnectionError("Instagram did not return the published Reel ID")
    return str(media_id)


def get_media_permalink(media_id: str, access_token: str, settings) -> str | None:
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                _graph_url(settings, media_id),
                params={"fields": "permalink"},
                headers=_bearer(access_token),
            )
            payload = _json_or_error(response, "reading the published Reel")
    except (httpx.HTTPError, InstagramConnectionError):
        return None
    permalink = payload.get("permalink")
    return str(permalink) if permalink else None


def sign_media_url(render_id: str, expires: int, secret: str) -> str:
    message = f"instagram-media:{render_id}:{expires}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def media_signature_is_valid(render_id: str, expires: int, signature: str, secret: str) -> bool:
    expected = sign_media_url(render_id, expires, secret)
    return hmac.compare_digest(signature, expected)
