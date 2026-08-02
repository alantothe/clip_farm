"""Platform connection listing and the Instagram OAuth connect/callback/disconnect flow."""

import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
import secrets
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import PlatformAccount
from app.schemas import ConnectedAccountOut, DeletionOut, PlatformConnectionOut
from app.services.instagram import (
    INSTAGRAM_SCOPES,
    InstagramConnectionError,
    encrypt_token,
    exchange_authorization_code,
)


settings = get_settings()
logger = logging.getLogger(__name__)
INSTAGRAM_STATE_COOKIE = "clip_farm_instagram_oauth_state"
INSTAGRAM_STATE_TTL_SECONDS = 10 * 60

router = APIRouter()


def _encode_oauth_state() -> str:
    if not settings.instagram_app_secret:
        raise HTTPException(status_code=503, detail="Instagram connection is not configured")
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"nonce": secrets.token_urlsafe(24), "issued_at": int(time.time())},
            separators=(",", ":"),
        ).encode()
    ).decode().rstrip("=")
    signature = hmac.new(
        settings.instagram_app_secret.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{signature}"


def _oauth_state_is_valid(state: str, cookie_state: str | None) -> bool:
    if not settings.instagram_app_secret or not cookie_state:
        return False
    if not hmac.compare_digest(state, cookie_state):
        return False
    try:
        payload, supplied_signature = state.rsplit(".", 1)
        expected_signature = hmac.new(
            settings.instagram_app_secret.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return False
        padded = payload + "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode())
        age = int(time.time()) - int(data["issued_at"])
        return 0 <= age <= INSTAGRAM_STATE_TTL_SECONDS and bool(data["nonce"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return False


def _settings_redirect(instagram: str, reason: str | None = None) -> RedirectResponse:
    query = {"instagram": instagram}
    if reason:
        query["reason"] = reason
    response = RedirectResponse(
        f"{settings.frontend_url.rstrip('/')}/settings?{urlencode(query)}",
        status_code=302,
    )
    response.delete_cookie(INSTAGRAM_STATE_COOKIE)
    return response


def _serialize_connected_account(account: PlatformAccount) -> ConnectedAccountOut:
    return ConnectedAccountOut.model_validate(account)


@router.get(f"{settings.api_prefix}/platforms", response_model=list[PlatformConnectionOut])
def list_platform_connections(
    session: Session = Depends(get_db),
) -> list[PlatformConnectionOut]:
    account = session.scalar(
        select(PlatformAccount).where(PlatformAccount.platform == "instagram")
    )
    return [
        PlatformConnectionOut(
            platform="instagram",
            display_name="Instagram",
            configured=settings.instagram_is_configured,
            missing_configuration=settings.instagram_missing_configuration,
            account=_serialize_connected_account(account) if account else None,
        )
    ]


@router.get(f"{settings.api_prefix}/platforms/instagram/connect")
def connect_instagram() -> RedirectResponse:
    if not settings.instagram_is_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Instagram connection is not configured",
                "missing": settings.instagram_missing_configuration,
            },
        )
    state = _encode_oauth_state()
    authorization_url = "https://www.instagram.com/oauth/authorize?" + urlencode(
        {
            "client_id": settings.instagram_app_id,
            "redirect_uri": settings.instagram_redirect_uri,
            "response_type": "code",
            "scope": ",".join(INSTAGRAM_SCOPES),
            "state": state,
            "force_reauth": "true",
        }
    )
    response = RedirectResponse(authorization_url, status_code=302)
    response.set_cookie(
        INSTAGRAM_STATE_COOKIE,
        state,
        max_age=INSTAGRAM_STATE_TTL_SECONDS,
        httponly=True,
        secure=settings.instagram_redirect_uri.startswith("https://"),
        samesite="lax",
    )
    return response


@router.get(f"{settings.api_prefix}/platforms/instagram/callback")
def instagram_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: Session = Depends(get_db),
) -> RedirectResponse:
    if error:
        return _settings_redirect("error", "authorization_denied")
    cookie_state = request.cookies.get(INSTAGRAM_STATE_COOKIE)
    if not state or not _oauth_state_is_valid(state, cookie_state):
        return _settings_redirect("error", "invalid_state")
    if not code:
        return _settings_redirect("error", "missing_code")
    try:
        identity = exchange_authorization_code(code, settings)
        encrypted_token = encrypt_token(identity.access_token, settings.token_encryption_key or "")
    except InstagramConnectionError:
        logger.warning("Instagram OAuth callback failed", exc_info=True)
        return _settings_redirect("error", "connection_failed")

    account = session.scalar(
        select(PlatformAccount).where(PlatformAccount.platform == "instagram")
    )
    if not account:
        account = PlatformAccount(platform="instagram")
        session.add(account)
    account.remote_user_id = identity.remote_user_id
    account.username = identity.username
    account.display_name = identity.display_name
    account.access_token_encrypted = encrypted_token
    account.scopes = ",".join(INSTAGRAM_SCOPES)
    account.token_expires_at = identity.expires_at
    account.status = "connected"
    account.connected_at = datetime.now(timezone.utc)
    account.updated_at = datetime.now(timezone.utc)
    session.commit()
    return _settings_redirect("connected")


@router.delete(
    f"{settings.api_prefix}/platforms/instagram",
    response_model=DeletionOut,
)
def disconnect_instagram(session: Session = Depends(get_db)) -> DeletionOut:
    account = session.scalar(
        select(PlatformAccount).where(PlatformAccount.platform == "instagram")
    )
    if not account:
        return DeletionOut(deleted=0)
    session.delete(account)
    session.commit()
    return DeletionOut(deleted=1)
