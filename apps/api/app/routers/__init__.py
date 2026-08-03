"""API routers grouped by domain."""

from app.routers.batches import router as batches_router
from app.routers.batch_media import router as batch_media_router
from app.routers.jobs import router as jobs_router
from app.routers.media import router as media_router
from app.routers.platforms import router as platforms_router
from app.routers.projects import router as projects_router
from app.routers.publishing import router as publishing_router
from app.routers.storage import router as storage_router
from app.routers.titles import router as titles_router

__all__ = [
    "batches_router",
    "batch_media_router",
    "jobs_router",
    "media_router",
    "platforms_router",
    "projects_router",
    "publishing_router",
    "storage_router",
    "titles_router",
]
