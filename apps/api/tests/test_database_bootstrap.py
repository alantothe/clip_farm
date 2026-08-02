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
