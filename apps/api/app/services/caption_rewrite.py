import re

from app.config import Settings
from app.services.google_credentials import service_account_credentials


DIRECT_QUOTE_RE = re.compile(r'"[^"]*"|“[^”]*”')
PROFANITY = (
    (re.compile(r"\bf+u+c+k+(?:e[dr]|ing|s)?\b", re.IGNORECASE), "f*ck"),
    (re.compile(r"\bs+h+i+t+(?:ty|tier|tiest|ting|s)?\b", re.IGNORECASE), "sh*t"),
    (re.compile(r"\bb+i+t+c+h+(?:es|y)?\b", re.IGNORECASE), "b*tch"),
    (re.compile(r"\ba+s+s+h+o+l+e+s?\b", re.IGNORECASE), "a**hole"),
    (re.compile(r"\bb+a+s+t+a+r+d+s?\b", re.IGNORECASE), "b*stard"),
    (re.compile(r"\bd+a+m+n+(?:ed|ing)?\b", re.IGNORECASE), "d*mn"),
)


class CaptionRewriteError(RuntimeError):
    pass


def _protect_direct_quotes(text: str) -> tuple[str, list[str]]:
    quotes: list[str] = []

    def replace(match: re.Match[str]) -> str:
        index = len(quotes)
        quotes.append(match.group(0))
        return f"[[[DIRECT_QUOTE_{index}]]]"

    return DIRECT_QUOTE_RE.sub(replace, text), quotes


def _restore_direct_quotes(text: str, quotes: list[str]) -> str:
    restored = text
    for index, quote in enumerate(quotes):
        token = f"[[[DIRECT_QUOTE_{index}]]]"
        if restored.count(token) != 1:
            raise CaptionRewriteError("The AI rewrite did not preserve a direct quote")
        restored = restored.replace(token, quote)
    if re.search(r"\[\[\[DIRECT_QUOTE_\d+\]\]\]", restored):
        raise CaptionRewriteError("The AI rewrite returned an unknown quote marker")
    return restored


def censor_profanity(text: str) -> str:
    protected, quotes = _protect_direct_quotes(text)
    for pattern, replacement in PROFANITY:
        protected = pattern.sub(replacement, protected)
    return _restore_direct_quotes(protected, quotes)


def rewrite_social_caption(*, caption: str, settings: Settings) -> str:
    value = caption.strip()
    if not value:
        raise CaptionRewriteError("Add a caption before asking AI to rewrite it")
    if not settings.google_cloud_project and not settings.google_service_account_json:
        raise CaptionRewriteError("Set GOOGLE_CLOUD_PROJECT to enable AI caption rewrites")

    protected, quotes = _protect_direct_quotes(value)
    try:
        from google import genai
        from google.genai import types

        credentials = service_account_credentials(settings)
        project = settings.google_cloud_project or getattr(credentials, "project_id", None)
        if not project:
            raise CaptionRewriteError("Set GOOGLE_CLOUD_PROJECT to enable AI caption rewrites")
        with genai.Client(
            vertexai=True,
            credentials=credentials,
            project=project,
            location=settings.google_cloud_location,
        ) as client:
            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=protected,
                config=types.GenerateContentConfig(
                    system_instruction=(
                        "Rewrite the supplied social-media caption into a concise, natural Instagram "
                        "caption. Keep its meaning, factual claims, URLs, @mentions, and hashtags. "
                        "Do not add facts, headings, commentary, or quotation marks. Text tokens shaped "
                        "like [[[DIRECT_QUOTE_0]]] are immutable placeholders: reproduce every one "
                        "exactly once and do not move text into or out of them. Use brand-safe wording "
                        "outside those placeholders. Keep the result within Instagram's 2,200-character "
                        "caption limit. Return only the rewritten caption."
                    ),
                    temperature=0.4,
                    max_output_tokens=1200,
                ),
            )
    except CaptionRewriteError:
        raise
    except Exception as exc:
        raise CaptionRewriteError(f"Gemini could not rewrite the caption: {exc}") from exc

    generated = (response.text or "").strip()
    if not generated:
        raise CaptionRewriteError("Gemini returned an empty caption")
    restored = _restore_direct_quotes(generated, quotes)
    censored = censor_profanity(restored)
    if len(censored) > 2200:
        raise CaptionRewriteError("Gemini returned a caption over Instagram's 2,200-character limit")
    return censored
