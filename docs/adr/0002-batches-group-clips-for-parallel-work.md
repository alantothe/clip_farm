# Batches group Clips so several imports can run in parallel

Working a set of videos through Clip Farm meant importing them one at a time into a single flat list, where the only way to tell one job from another was to remember which title was which. Batch Process adds a Mode that takes many files at once, and a **Batch** — a named set of Clips imported and worked on together — so more than one of those sets can be in flight without crowding each other.

A Batch deliberately owns nothing but its name and its membership. It has no shared trim, layout, or Subtitle settings, and no batch-level render. Each Clip inside it imports behind its own Job and is edited and rendered exactly as a loose Clip is, which is what let the whole editor be reused unchanged. Anything that renders a Batch as a unit can be added later on top of this; the reverse — unpicking shared settings once Clips depend on them — would not have been as easy.

`GET /api/projects` now returns only Clips with no Batch. A Batch's Clips are reached through `GET /api/batches/{id}`. Without that split, uploads would surface in the X mode's rail and "Clear all" would reach into Batches.

## The word "project"

The operator asked for "projects". `CONTEXT.md` already forbids that word for the unit of work, and `Project` is the model class for what the glossary calls a Clip — the older name ADR 0001 left in the schema. A second, different "project" alongside it would have made the codebase unreadable. **Batch** is the glossary term instead; the request itself is unchanged.

## Uploads keep an empty Origin URL rather than a null one

ADR 0001 gave a Clip an Origin Kind independent of its Format, and `CONTEXT.md` notes that uploads have no Origin URL. The obvious schema for that is a nullable `source_url` and `source_post_id`.

They stay `NOT NULL`, defaulting to the empty string, because nothing runs Alembic. `init_db` bootstraps SQLite with `create_all` plus a list of additive `ALTER TABLE ADD COLUMN` patches, and that is the only upgrade path a local database or the deployed volume ever sees. Relaxing `NOT NULL` in SQLite means rebuilding the table — dropping and recreating `projects` while `PRAGMA foreign_keys=ON` and every Artifact, Render, and Job points at it. That is not a risk worth taking on startup to avoid two empty strings.

So `origin_kind` and `batch_id` are added as plain additive columns, and `ProjectOut` reports an absent Origin honestly as `null`. The migration in `0009_batches.py` matches. If Alembic ever becomes the real upgrade path, making those two columns nullable is the change to make.
