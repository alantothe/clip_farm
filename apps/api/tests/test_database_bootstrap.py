"""The app bootstraps SQLite with create_all plus an additive-column patch list
in init_db, not with Alembic. Existing databases (local dev and the deployed
volume) therefore only gain new Project columns if init_db knows how to add
them, so that upgrade path needs its own coverage.
"""

from sqlalchemy import create_engine, inspect, text

from app import database


# The projects table as it stood before the mode column was introduced.
LEGACY_PROJECTS_TABLE = """
CREATE TABLE projects (
    id VARCHAR NOT NULL PRIMARY KEY,
    source_url VARCHAR NOT NULL,
    source_post_id VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    source_caption TEXT,
    social_caption TEXT,
    status VARCHAR NOT NULL,
    transcription_status VARCHAR NOT NULL,
    error_message TEXT,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    fps FLOAT,
    trim_start_ms INTEGER NOT NULL,
    trim_end_ms INTEGER,
    layout VARCHAR NOT NULL,
    crop_center_x FLOAT NOT NULL,
    captions_enabled BOOLEAN NOT NULL,
    caption_style VARCHAR NOT NULL,
    caption_position VARCHAR NOT NULL DEFAULT 'bottom',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
)
"""

LEGACY_ROW = """
INSERT INTO projects (
    id, source_url, source_post_id, title, status, transcription_status,
    trim_start_ms, layout, crop_center_x, captions_enabled, caption_style,
    created_at, updated_at
) VALUES (
    'legacy-1', 'https://x.com/i/status/1', '1', 'Legacy clip', 'ready', 'complete',
    0, 'fit_background', 50.0, 1, 'bold', '2026-01-01 00:00:00', '2026-01-01 00:00:00'
)
"""


def test_init_db_backfills_mode_on_a_pre_mode_database(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(text(LEGACY_PROJECTS_TABLE))
        connection.execute(text(LEGACY_ROW))

    assert "mode" not in {column["name"] for column in inspect(engine).get_columns("projects")}

    monkeypatch.setattr(database, "engine", engine)
    database.init_db()

    assert "mode" in {column["name"] for column in inspect(engine).get_columns("projects")}
    with engine.connect() as connection:
        modes = connection.execute(text("SELECT mode FROM projects")).scalars().all()
    assert modes == ["x-to-vertical"]


def test_init_db_is_idempotent(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    monkeypatch.setattr(database, "engine", engine)

    database.init_db()
    database.init_db()

    assert "mode" in {column["name"] for column in inspect(engine).get_columns("projects")}


# `shots` as ADR 0003 shipped it, before a Shot carried its own Trim.
LEGACY_SHOTS_TABLE = """
CREATE TABLE shots (
    id VARCHAR NOT NULL,
    batch_id VARCHAR NOT NULL,
    project_id VARCHAR NOT NULL,
    position INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_shots_project UNIQUE (project_id),
    FOREIGN KEY(batch_id) REFERENCES batches (id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
)
"""


def _legacy_sequence_database(tmp_path, name="legacy-shots.db"):
    """A database holding a Batch with two placed Shots, on the old shape."""
    engine = create_engine(f"sqlite:///{tmp_path / name}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE batches (id VARCHAR NOT NULL PRIMARY KEY)"))
        connection.execute(text(LEGACY_PROJECTS_TABLE))
        connection.execute(text(LEGACY_SHOTS_TABLE))
        connection.execute(text("INSERT INTO batches (id) VALUES ('batch-1')"))
        for index in (0, 1):
            connection.execute(
                text(
                    "INSERT INTO projects ("
                    "  id, source_url, source_post_id, title, status,"
                    "  transcription_status, trim_start_ms, layout, crop_center_x,"
                    "  captions_enabled, caption_style, created_at, updated_at"
                    f") VALUES ('legacy-{index}', '', '', 'Legacy {index}', 'ready',"
                    "  'complete', 0, 'fit_background', 50.0, 1, 'bold',"
                    "  '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO shots (id, batch_id, project_id, position, created_at) "
                    f"VALUES ('shot-{index}', 'batch-1', 'legacy-{index}', {index}, "
                    "'2026-01-01 00:00:00')"
                )
            )
    return engine


def test_init_db_drops_the_unique_clip_constraint_from_shots(tmp_path, monkeypatch):
    """ADR 0004: one Clip can have several Shots, which needs a table rebuild."""
    engine = _legacy_sequence_database(tmp_path)
    monkeypatch.setattr(database, "engine", engine)

    database.init_db()

    with engine.connect() as connection:
        ddl = connection.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name='shots'")
        ).scalar()
        # The rows survived the rebuild, in order.
        rows = connection.execute(
            text("SELECT id, project_id, position FROM shots ORDER BY position")
        ).all()
        indexes = connection.execute(
            text("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='shots'")
        ).scalars().all()

    assert "uq_shots_project" not in ddl
    assert rows == [("shot-0", "legacy-0", 0), ("shot-1", "legacy-1", 1)]
    assert {"ix_shots_batch_id", "ix_shots_project_id"} <= set(indexes)
    columns = {column["name"] for column in inspect(engine).get_columns("shots")}
    assert {"trim_start_ms", "trim_end_ms"} <= columns


def test_the_shots_rebuild_does_not_run_twice(tmp_path, monkeypatch):
    """The DDL check is what stops it; a rebuilt table must be left alone."""
    engine = _legacy_sequence_database(tmp_path)
    monkeypatch.setattr(database, "engine", engine)

    database.init_db()
    database.init_db()

    with engine.connect() as connection:
        count = connection.execute(text("SELECT count(*) FROM shots")).scalar()
        leftovers = connection.execute(
            text("SELECT name FROM sqlite_master WHERE name='shots__new'")
        ).scalars().all()
    assert count == 2
    assert leftovers == []


def test_a_rebuilt_shots_table_accepts_a_repeated_clip(tmp_path, monkeypatch):
    """The point of the rebuild: the same Clip placed twice."""
    engine = _legacy_sequence_database(tmp_path)
    monkeypatch.setattr(database, "engine", engine)
    database.init_db()

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO shots (id, batch_id, project_id, position, created_at) "
                "VALUES ('shot-2', 'batch-1', 'legacy-0', 2, '2026-01-01 00:00:00')"
            )
        )

    with engine.connect() as connection:
        placements = connection.execute(
            text("SELECT count(*) FROM shots WHERE project_id='legacy-0'")
        ).scalar()
    assert placements == 2


def test_init_db_backfills_format_on_a_pre_format_batches_table(tmp_path, monkeypatch):
    """ADR 0006: every Batch that predates the Format rendered 1080x1920."""
    engine = _legacy_sequence_database(tmp_path, name="legacy-batches.db")
    assert "format" not in {
        column["name"] for column in inspect(engine).get_columns("batches")
    }

    monkeypatch.setattr(database, "engine", engine)
    database.init_db()

    assert "format" in {column["name"] for column in inspect(engine).get_columns("batches")}
    with engine.connect() as connection:
        formats = connection.execute(text("SELECT format FROM batches")).scalars().all()
    # The Batch created before the column existed is vertical, which is what it
    # always rendered as.
    assert formats == ["vertical"]
