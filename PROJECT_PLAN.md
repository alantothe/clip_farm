# Clip Farm: Technical Game Plan

## 1. Product Boundary

Build a single-owner web application that:

1. Watches an allowlist of X profiles that the operator owns or has permission to repurpose.
2. Finds posts containing video and imports the source media and post metadata.
3. Creates vertical, captioned MP4 renditions for TikTok and Instagram Reels.
4. Lets the operator review, edit, approve, export, schedule, and eventually publish each rendition.

The first useful release should produce a downloadable, platform-ready MP4. Direct publishing comes later because TikTok and Instagram require app registration, OAuth permissions, review, and user-consent flows.

## 2. Recommended Stack

### Frontend

| Concern | Choice | Reason |
| --- | --- | --- |
| Application | React + TypeScript + Vite | Fast dashboard development without server-rendering complexity that this private tool does not need. |
| Routing | TanStack Router | Typed routes and search parameters for filters and editor state. |
| Server state | TanStack Query | Handles polling, retries, caching, and invalidation for jobs and media. |
| UI | Tailwind CSS + shadcn/ui/Radix primitives | Accessible controls with enough flexibility for a dense production dashboard. |
| Forms | React Hook Form + Zod | Shared validation patterns and good form performance. |
| Video preview | Native HTML video | The browser should preview server-rendered proxy files; it should not render final videos. |
| Tests | Vitest + Testing Library + Playwright | Unit, component, and complete workflow coverage. |

The frontend should be a work-focused dashboard, not a landing page. Its primary views are Sources, Inbox, Editor, Queue, Library, Publishing, and Settings.

### Backend and Worker

| Concern | Choice | Reason |
| --- | --- | --- |
| API | Python + FastAPI + Pydantic | Typed REST API, automatic OpenAPI, and a good fit for media and transcription libraries. |
| Package management | `uv` | Fast, reproducible Python environments and lock files. |
| Database | SQLite | Required choice; simple operations and backups for a single-host app. |
| ORM/migrations | SQLAlchemy 2 + Alembic | Explicit schema migrations and a path to PostgreSQL if the product outgrows SQLite. |
| Job queue | Huey with a separate SQLite queue database | Durable background jobs, scheduling, retries, and no Redis requirement. |
| Video processing | FFmpeg + FFprobe | Proven encoding, cropping, compositing, caption burning, audio normalization, and inspection. |
| Transcription | `faster-whisper` behind an adapter | Can run locally; an external transcription provider can be added without changing the pipeline. |
| HTTP clients | HTTPX | Async platform API and media requests. |
| API tests | Pytest | Unit and integration tests for services, adapters, and endpoints. |

Run FFmpeg jobs in the worker, never inside the FastAPI request process. FastAPI should enqueue work and immediately return a job ID.

### Storage

- `data/app.db`: application records.
- `data/queue.db`: Huey queue and schedule state, isolated to reduce contention with application writes.
- `data/media/`: local originals, proxies, thumbnails, captions, and exports during development.
- S3-compatible object storage in production for media files. Cloudflare R2, AWS S3, or MinIO are suitable behind one storage interface.
- SQLite stores object keys, checksums, dimensions, durations, and status. It does not store video blobs.

Use SQLite WAL mode, foreign keys, a busy timeout, short transactions, and automatic backups. SQLite makes this a single-host application. Do not deploy multiple API/worker hosts against one SQLite file on network storage.

### Deployment

Use Docker Compose on one persistent Linux VM:

```text
browser
   |
Caddy (HTTPS and static frontend)
   |
FastAPI API ---- app.db
   |
SQLite Huey queue ---- Python worker ---- FFmpeg
                              |
                     local volume / S3 storage
                              |
                  X / TikTok / Instagram APIs
```

Services:

- `web`: compiled Vite assets served by Caddy.
- `api`: FastAPI process.
- `worker`: Huey consumer with FFmpeg available.
- No Redis and no PostgreSQL for the initial product.

Avoid serverless deployment: video encoding is long-running, CPU-heavy, and needs durable scratch space.

## 3. Core Screens

### Sources

- Add an X username and record the content-usage permission basis.
- Enable/disable watching, set polling interval, and show last successful sync.
- Configure minimum duration, maximum duration, language, and engagement filters.

### Inbox

- Show newly discovered videos with source profile, post text, date, duration, and metrics.
- Actions: ignore, approve, open source, or create rendition.
- Deduplicate by X post ID, media key, and downloaded-file checksum.

### Editor

- Video preview with an explicit start/end range.
- 9:16 crop position and safe-area preview.
- Caption transcript editor and caption-style presets.
- Title/header text, optional source attribution, and cover-frame selection.
- Audio normalization toggle and output preset.
- Render button with progress and failure details.

The initial editor should generate FFmpeg parameters; it should not attempt a browser-based nonlinear video editor.

### Queue

- Jobs grouped by queued, running, retrying, failed, and complete.
- Progress, current stage, attempt count, logs, cancel, retry, and archive actions.

### Library and Publishing

- Compare original, proxy, and final renditions.
- Download the finished MP4 and caption text.
- Set platform-specific caption, hashtags, privacy, scheduled time, and cover.
- Require an explicit approval before any platform upload.

## 4. Processing Pipeline

Every stage should be idempotent and record its input/output artifacts:

1. `sync_source`: fetch recent posts for an X user through the official API.
2. `ingest_post`: store the post, metrics snapshot, and expanded media metadata.
3. `download_original`: select an appropriate MP4 media variant and save it with a checksum.
4. `inspect_media`: use FFprobe to capture codecs, dimensions, frame rate, audio streams, and duration.
5. `create_proxy`: make a small preview file for the browser.
6. `transcribe`: produce timestamped words/segments and an editable WebVTT or SRT artifact.
7. `render_rendition`: crop/pad to 1080x1920, burn captions, normalize audio, and encode H.264/AAC MP4.
8. `validate_rendition`: use FFprobe plus platform-specific duration, size, codec, and aspect-ratio checks.
9. `approve_rendition`: save an immutable approval record for the exact file checksum.
10. `publish`: call a platform adapter or expose a manual download.
11. `poll_publish_status`: reconcile the remote processing result and store the remote post ID/URL.

Keep platform integrations behind adapters:

```text
SourceProvider: list_posts(), get_media()
Publisher: validate(), upload(), get_status()
Storage: put(), get(), signed_url(), delete()
Transcriber: transcribe()
```

This makes official API changes and local-development fakes easier to handle.

## 5. Initial Data Model

| Table | Purpose |
| --- | --- |
| `sources` | X profiles, polling configuration, permission record, sync cursor, and status. |
| `source_posts` | X post ID, text, timestamps, author, metrics, and raw API snapshot. |
| `source_media` | Media key, variants, original metadata, checksum, and storage key. |
| `projects` | One editable clip project linked to source media. |
| `transcripts` | Transcript engine/version, language, segments, words, and edit state. |
| `renditions` | Edit specification, target platform, output metadata, checksum, and approval state. |
| `artifacts` | Original, proxy, thumbnail, subtitle, and rendered-file storage records. |
| `jobs` | User-visible processing state, progress, attempts, errors, and timestamps. |
| `platform_accounts` | Connected account metadata and encrypted token references. |
| `publish_attempts` | Schedule, caption, remote IDs, response state, and errors. |
| `audit_events` | Approvals, publishing actions, source changes, and destructive actions. |

Store OAuth tokens encrypted at rest with a key supplied through an environment variable. Never put secrets or access tokens in SQLite raw-API snapshots, job arguments, or logs.

## 6. API Shape

Use REST endpoints and Server-Sent Events (SSE) for one-way progress updates:

```text
GET/POST       /api/sources
POST           /api/sources/{id}/sync
GET            /api/inbox
GET/POST       /api/projects
PATCH          /api/projects/{id}
POST           /api/projects/{id}/transcribe
POST           /api/projects/{id}/render
POST           /api/renditions/{id}/approve
GET            /api/jobs
GET            /api/jobs/events
POST           /api/jobs/{id}/retry
POST           /api/platforms/{platform}/connect
POST           /api/renditions/{id}/publish
```

Generate the frontend API client from FastAPI's OpenAPI document so request and response types do not drift.

## 7. Platform Constraints to Prove Early

### X ingestion

Use the official X API, not browser scraping. X post lookup/timeline responses can expand attached media and request media fields including video variants. Access is subject to X developer access, pricing, rate limits, and policy changes.

Before building the dashboard, prove that the selected X access plan can:

1. Resolve a username and read its recent timeline.
2. Return video media and usable MP4 variants for the intended profiles.
3. Poll frequently enough for the product's expected number of profiles.

### TikTok publishing

TikTok's Content Posting API supports file upload and URL-based upload, but Direct Post requires the `video.publish` scope, the target user's authorization, an explicit consent flow, and app review. Unaudited clients are restricted to private visibility. TikTok's guidelines also emphasize original content and prohibit unwanted promotional watermarks.

Therefore, ship manual export first, then draft upload, then Direct Post after the consent UI and audit requirements are satisfied.

### Instagram publishing

Instagram Reels publishing creates a media container with a reachable `video_url`, waits for processing, and then publishes the container. This is why production object storage is required even though the application database is SQLite. Account type, permissions, app review, API versions, and media specifications must be verified during the integration spike.

### Rights and safety

Publicly viewable does not mean reusable. Restrict sources to content the operator owns or is licensed to repurpose. Preserve the source URL, author, permission basis, import time, and file checksum. Provide takedown/deletion controls and avoid automatically publishing newly discovered content without review.

## 8. Delivery Phases

### Phase 0: Feasibility spike

- Register developer apps and obtain test credentials.
- Ingest one owned X profile through the official API.
- Download one video, inspect it, and render a compliant 9:16 H.264/AAC file with FFmpeg.
- Manually upload the result to TikTok and Instagram to validate visual safe areas and encoding.
- Test TikTok sandbox/private posting and an Instagram test account.

Exit condition: the official APIs and one end-to-end sample are proven before significant UI work.

### Phase 1: Local vertical slice

- Scaffold the Vite frontend, FastAPI backend, SQLite schema/migrations, Huey worker, and local storage.
- Build Sources, Inbox, basic Editor, Queue, and Library screens.
- Support manual X post URL import as a useful fallback to scheduled profile polling.
- Produce downloadable final MP4 files with progress and retry behavior.

Exit condition: source URL to reviewed downloadable rendition works after process restarts.

### Phase 2: Automated ingestion and editing

- Scheduled source polling, cursors, rate limiting, and deduplication.
- Transcription and editable captions.
- Crop controls, caption presets, cover selection, and platform validators.
- Artifact retention rules and cleanup jobs.

Exit condition: approved profiles reliably populate an inbox and render repeatable outputs.

### Phase 3: Publishing integrations

- OAuth account connection and encrypted token storage.
- TikTok draft upload first, then audited Direct Post.
- Instagram Reels container upload, status polling, and publish flow.
- Per-platform captions, scheduling, consent, approval, and audit log.

Exit condition: approved renditions publish once, failures are visible, and retries cannot create accidental duplicates.

### Phase 4: Production hardening

- Authentication if the service is reachable beyond a private network.
- HTTPS, CSRF protection, secret rotation, token redaction, backups, and restore drills.
- Metrics for queue depth, render time, disk usage, API errors, and expiring platform tokens.
- Playwright workflow tests and fixed media fixtures for render validation.

## 9. Repository Layout

```text
clip_farm/
  apps/
    web/                 # React/Vite application
    api/                 # FastAPI routes and application bootstrap
    worker/              # Huey tasks and worker bootstrap
  packages/
    api-client/          # Generated TypeScript client
  backend/
    clip_farm/
      domain/            # Entities and business rules
      services/          # Ingestion, render, validation, publishing use cases
      adapters/          # X, TikTok, Instagram, storage, transcription
      db/                # SQLAlchemy models and repositories
  migrations/            # Alembic revisions
  tests/
    fixtures/media/      # Small, licensed test clips
  data/                  # Gitignored local databases and media
  compose.yaml
```

Keep the API and worker on the same Python package so business logic is not duplicated.

## 10. Decisions and Scaling Triggers

Start with:

- One deployable application, one API process, and one media worker.
- SQLite for application data and a separate SQLite file for Huey.
- Manual review before publish.
- FFmpeg command specifications stored as structured JSON for reproducibility.
- Rules-based clipping and manual time ranges; AI clip selection is optional later.

Do not start with:

- Electron or native mobile apps.
- Microservices, Kubernetes, Redis, or PostgreSQL.
- Browser-side final video rendering.
- Scraping X or automating TikTok/Instagram browser sessions.
- Fully automatic publishing without explicit content approval.

Move the application database to PostgreSQL and Huey to Redis only when there is a concrete need for multiple application hosts, multiple concurrent users, or enough job traffic that SQLite write contention is measurable. SQLAlchemy and the adapter boundaries preserve that migration path.

## 11. First Implementation Milestone

The first milestone should be deliberately narrow:

> Paste an authorized X post URL, import its video, choose a time range, render a captioned 9:16 MP4, preview it, and download it.

That slice proves the difficult media path while avoiding source scheduling and publishing approvals. After it works reliably, add profile watching and platform publishing around it.

## References

- [X API overview](https://docs.x.com/x-api/overview)
- [X API media fields and expansions](https://docs.x.com/x-api/posts/lookup/integrate)
- [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started)
- [TikTok content-sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/)
- [Instagram content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Huey SQLite task queue guide](https://huey.readthedocs.io/en/stable/guide.html)
- [SQLite documentation](https://www.sqlite.org/docs.html)
