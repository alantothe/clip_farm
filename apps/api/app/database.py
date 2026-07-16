from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def configure_sqlite(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    # This project historically bootstraps SQLite with create_all rather than
    # running Alembic on startup. Keep existing local/volume databases usable
    # when additive fields are introduced.
    overlay_columns = {column["name"] for column in inspect(engine).get_columns("image_overlays")}
    overlay_additions = {
        "rotation_deg": "ALTER TABLE image_overlays ADD COLUMN rotation_deg FLOAT NOT NULL DEFAULT 0",
        "opacity": "ALTER TABLE image_overlays ADD COLUMN opacity FLOAT NOT NULL DEFAULT 1",
    }
    project_columns = {column["name"] for column in inspect(engine).get_columns("projects")}
    project_additions = {
        "source_caption": "ALTER TABLE projects ADD COLUMN source_caption TEXT",
        "social_caption": "ALTER TABLE projects ADD COLUMN social_caption TEXT",
        "caption_position": (
            "ALTER TABLE projects ADD COLUMN caption_position VARCHAR NOT NULL DEFAULT 'bottom'"
        ),
    }
    render_columns = {column["name"] for column in inspect(engine).get_columns("renders")}
    render_additions = {
        "caption_position": (
            "ALTER TABLE renders ADD COLUMN caption_position VARCHAR NOT NULL DEFAULT 'bottom'"
        ),
    }
    with engine.begin() as connection:
        for name, statement in overlay_additions.items():
            if name not in overlay_columns:
                connection.exec_driver_sql(statement)
        for name, statement in project_additions.items():
            if name not in project_columns:
                connection.exec_driver_sql(statement)
        for name, statement in render_additions.items():
            if name not in render_columns:
                connection.exec_driver_sql(statement)
