from huey import SqliteHuey

from app.config import get_settings


settings = get_settings()
huey = SqliteHuey(
    "clip-farm",
    filename=str(settings.queue_path),
    immediate=settings.worker_immediate,
    results=False,
    store_none=False,
)

