from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import init_db
from app.routers import (
    batches_router,
    jobs_router,
    media_router,
    platforms_router,
    projects_router,
    publishing_router,
    titles_router,
)


settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(platforms_router)
app.include_router(publishing_router)
app.include_router(media_router)
app.include_router(batches_router)
app.include_router(titles_router)
app.include_router(projects_router)
app.include_router(jobs_router)


if settings.web_dist_dir and (settings.web_dist_dir / "index.html").is_file():
    assets_dir = settings.web_dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="web-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_web_app(full_path: str) -> FileResponse:
        requested_file = settings.web_dist_dir / full_path
        if full_path and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(settings.web_dist_dir / "index.html")
