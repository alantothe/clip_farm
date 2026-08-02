"""API routers grouped by domain."""

from app.routers.jobs import router as jobs_router
from app.routers.media import router as media_router
from app.routers.platforms import router as platforms_router
from app.routers.projects import router as projects_router
from app.routers.publishing import router as publishing_router

__all__ = [
    "jobs_router",
    "media_router",
    "platforms_router",
    "projects_router",
    "publishing_router",
]
