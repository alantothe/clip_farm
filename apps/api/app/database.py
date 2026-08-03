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


def _rebuild_shots_without_unique_clip() -> None:
    """Drop `uq_shots_project` so one Clip can have several Shots (ADR 0004).

    Removing a UNIQUE constraint in SQLite means rebuilding the table, and
    nothing runs Alembic here — `init_db`'s additive ALTER list is the only
    upgrade path a real database sees. ADR 0002 declined this operation on
    `projects` and ADR 0003 on `renders`, both times because inbound foreign
    keys would have been left dangling mid-rebuild on startup. Nothing declared
    a foreign key to `shots.id`, so that risk was absent here.

    ADR 0005 has since added `parent_shot_id`, which points at this same table,
    so that argument is spent: this rebuild is safe because it already ran
    before the self-reference existed, and a further one would have to handle
    it. The columns added after this are ordinary additive ones.

    A database created after this change never has the old shape, so the DDL
    check below is what stops this running twice.
    """
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        ddl = connection.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='shots'"
        ).scalar()
        if not ddl or "uq_shots_project" not in ddl:
            return

        # SQLite's documented table-rebuild recipe. `foreign_keys` cannot be
        # changed inside a transaction, which is why this connection is not in
        # one until BEGIN.
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.exec_driver_sql("BEGIN")
        try:
            connection.exec_driver_sql(
                """
                CREATE TABLE shots__new (
                    id VARCHAR NOT NULL,
                    batch_id VARCHAR NOT NULL,
                    project_id VARCHAR NOT NULL,
                    position INTEGER NOT NULL,
                    trim_start_ms INTEGER,
                    trim_end_ms INTEGER,
                    created_at DATETIME NOT NULL,
                    PRIMARY KEY (id),
                    FOREIGN KEY(batch_id) REFERENCES batches (id) ON DELETE CASCADE,
                    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
                )
                """
            )
            connection.exec_driver_sql(
                "INSERT INTO shots__new (id, batch_id, project_id, position, created_at) "
                "SELECT id, batch_id, project_id, position, created_at FROM shots"
            )
            connection.exec_driver_sql("DROP TABLE shots")
            connection.exec_driver_sql("ALTER TABLE shots__new RENAME TO shots")
            connection.exec_driver_sql("CREATE INDEX ix_shots_batch_id ON shots (batch_id)")
            connection.exec_driver_sql("CREATE INDEX ix_shots_project_id ON shots (project_id)")
            connection.exec_driver_sql("COMMIT")
        except Exception:
            connection.exec_driver_sql("ROLLBACK")
            raise
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _rebuild_shots_without_unique_clip()
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
        "mode": (
            "ALTER TABLE projects ADD COLUMN mode VARCHAR NOT NULL DEFAULT 'x-to-vertical'"
        ),
        "origin_kind": (
            "ALTER TABLE projects ADD COLUMN origin_kind VARCHAR NOT NULL DEFAULT 'x'"
        ),
        # SQLite only accepts a REFERENCES column through ADD COLUMN when it
        # defaults to NULL, which a Clip outside any Batch does anyway.
        "batch_id": (
            "ALTER TABLE projects ADD COLUMN batch_id VARCHAR "
            "REFERENCES batches(id) ON DELETE SET NULL"
        ),
    }
    # A database whose `shots` was rebuilt above already has these; one created
    # between the Sequence shipping and ADR 0004 landing does not.
    shot_columns = {column["name"] for column in inspect(engine).get_columns("shots")}
    shot_additions = {
        "trim_start_ms": "ALTER TABLE shots ADD COLUMN trim_start_ms INTEGER",
        "trim_end_ms": "ALTER TABLE shots ADD COLUMN trim_end_ms INTEGER",
        # SQLite only accepts a REFERENCES column through ADD COLUMN when it
        # defaults to NULL, which a Shot that is not a Cutaway does anyway.
        "parent_shot_id": (
            "ALTER TABLE shots ADD COLUMN parent_shot_id VARCHAR "
            "REFERENCES shots(id) ON DELETE CASCADE"
        ),
        "offset_ms": "ALTER TABLE shots ADD COLUMN offset_ms INTEGER",
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
        for name, statement in shot_additions.items():
            if name not in shot_columns:
                connection.exec_driver_sql(statement)
        for name, statement in render_additions.items():
            if name not in render_columns:
                connection.exec_driver_sql(statement)
