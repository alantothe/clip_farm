# Clip Farm

Clip Farm is a fast production workspace for making social content and reposts.

Available now:

- turn landscape videos from X into finished vertical posts;
- upload several videos and assemble them into one multi-Clip Sequence;
- trim, crop, reframe, subtitle, and brand videos with Titles and images;
- save reusable Title Styles, Phrases, images, and complete layer arrangements;
- build four-photo Instagram covers;
- download finished 1080 × 1920 MP4s; and
- publish directly to Instagram Reels.

More focused content formats and publishing workflows are on the way.

> Only process videos and images you own or have permission to repurpose.

## What Clip Farm Offers

### Landscape X to Vertical

Paste an `x.com/.../status/...` URL and Clip Farm will:

- import the Source Video and available X post text with `yt-dlp`;
- inspect the media and create a browser preview and thumbnail;
- optionally generate timed Subtitles with Google Speech-to-Text;
- convert landscape footage to vertical with face-aware Smart Crop or a blurred Full Frame layout;
- let you trim the Clip, choose Subtitle style and placement, and edit every Subtitle segment;
- place reusable image Overlays at precise times, positions, sizes, rotations, and opacities;
- preserve the original post text alongside a separate Instagram Caption draft;
- rewrite and censor the Caption with Gemini while preserving direct quotations;
- render and download a 1080 × 1920 H.264/AAC MP4; and
- publish a completed Render directly to a connected Instagram professional account.

### Batch Process

A Batch is a named set of Clips that can be imported and edited independently, then arranged into one finished video through its Sequence. Multiple Batches and imports can remain in progress at once.

The Batch workspace includes:

- multi-file drag-and-drop upload with independent import progress and error reporting;
- a searchable video bin with multi-select, preview, rename, and deletion controls;
- the same trim, layout, Subtitle, Caption, and Overlay tools used by loose Clips;
- a proportional Timeline where Clips can be placed more than once, reordered, and removed with undo;
- per-Shot trims, zoom, horizontal and vertical framing, and Subtitle toggles;
- Cutaways that replace a base Shot's picture for a timed span while its audio continues;
- a shared Player and Timeline playhead with scrubbing, frame stepping, cut navigation, playback speed, mute, fullscreen, safe-area guides, and review-range looping;
- drag-and-resize Titles and images directly on the Player, with centre snapping;
- a three-row Title Track that supports up to three simultaneous Titles;
- 35 built-in Title Styles, vendored fonts, and detailed controls for font, weight, colour, alignment, outline, shadow, panel, opacity, spacing, placement, wrapping, and rotation;
- reusable custom Title Styles and Phrases that are available in every Batch;
- reusable image Storage for Overlays, Sequence images, and cover art;
- Layer Profiles that save a complete visible Title-and-image arrangement and can be added to or swapped onto another Batch;
- background Sequence rendering with progress, cancellation, retry, download metadata, and stale-export warnings when the Batch changes; and
- direct Instagram publishing with a Caption, optional Gemini rewrite, feed sharing, a Cover Frame or custom Cover Image, per-publication progress, retry, and permalink reporting.

### Four-photo Instagram Cover

Choose four JPG, PNG, or WebP images and arrange them as equal horizontal strips in an exact 1080 × 1920 cover. Each strip has independent drag, pinch/scroll zoom, reposition, reset, and replace controls with a live full-cover preview.

The finished PNG can be downloaded directly. When the tool is opened from the Batch publishing flow, it can also be saved to Storage and used as that Reel's Cover Image. In the standalone mode, the source photos stay in the browser.

## Current Output and Publishing Support

| Capability | Status |
| --- | --- |
| Vertical MP4 export | 1080 × 1920, H.264 video with AAC audio |
| Manual download | Available for individual Renders and Sequence Renders |
| Instagram Reels | Direct publishing for connected Business and Creator accounts |
| Instagram covers | Cover Frame or uploaded/cropped Cover Image |
| TikTok and YouTube Shorts | Vertical files are suitable for manual upload; direct publishing is not connected yet |

## How It Works

Clip Farm is a monorepo with three cooperating processes:

```text
React/Vite web app  ──HTTP──>  FastAPI + SQLite
                                  │
                                  └── Huey worker ──> FFmpeg / Google APIs / Instagram
```

- `apps/web`: React, TypeScript, Vite, TanStack Query, and Vitest.
- `apps/api`: FastAPI, SQLAlchemy, Alembic, Huey, FFmpeg, Google Speech-to-Text, Gemini on Vertex AI, Instagram publishing, and Pytest.
- `data/app.db`: application data.
- `data/queue.db`: durable background-job state.
- `data/projects`, `data/batches`, `data/storage`, and `data/layer-profiles`: Source Videos, previews, images, and finished files.

SQLite and local media storage make this a single-host application. The API and worker must share the same persistent filesystem.

## Local Setup

### Prerequisites

- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/)
- Node.js 18+ and npm
- FFmpeg and FFprobe
- Google Application Default Credentials only for automatic Subtitles and Gemini Caption rewrites

Install the JavaScript and Python dependencies:

```bash
npm run setup
cp apps/api/.env.example apps/api/.env
```

Start the frontend, API, and worker together:

```bash
npm start
```

Open `http://localhost:5173`. The API runs at `http://localhost:8000`, its OpenAPI documentation is at `http://localhost:8000/docs`, and the health check is at `/health`.

To run each process separately, use three terminals:

```bash
make dev-api
make dev-worker
make dev-web
```

## Configuration

All settings are documented in `apps/api/.env.example`.

### Google Cloud

Set `GOOGLE_CLOUD_PROJECT` and provide Application Default Credentials to enable automatic Subtitles and Gemini Caption rewriting. `GEMINI_MODEL` defaults to `gemini-2.5-flash`.

`GCS_BUCKET` is optional. With a bucket, long videos use one Speech-to-Text batch job. Without it, Clip Farm sends local 55-second audio chunks through the synchronous API. The core import, editing, rendering, cover-building, and download workflows remain available without Google configuration.

Production can use `GOOGLE_SERVICE_ACCOUNT_JSON` when an ADC file cannot be mounted. Store the complete service-account JSON as a secret, grant only the needed Speech and Vertex AI permissions, and prefer workload identity federation where the hosting platform supports it.

### X Imports

`YTDLP_COOKIES_FILE` optionally points to a cookies file for X posts that require authentication. `MAX_SOURCE_DURATION_SECONDS` and `MAX_SOURCE_BYTES` limit imported and uploaded videos.

### Instagram

Clip Farm uses the Instagram API with Instagram Login for professional Business and Creator accounts.

1. Create a Meta Business app and add the Instagram product.
2. Configure Business Login for Instagram with `instagram_business_basic` and `instagram_business_content_publish`.
3. Register `http://localhost:8000/api/platforms/instagram/callback` as the local OAuth redirect URI.
4. Set `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, and `INSTAGRAM_REDIRECT_URI` in `apps/api/.env`.
5. Generate `TOKEN_ENCRYPTION_KEY` with the command in `.env.example` and keep it stable.
6. Restart the API, then open **Settings → Connected Apps → Connect Instagram**.

Access tokens are encrypted in SQLite and are never returned to the browser. Clip Farm refreshes long-lived tokens when they approach expiration and checks the connection daily.

For a real publication, `PUBLIC_BASE_URL` must be the public HTTPS origin serving the API. Instagram must be able to retrieve the signed Render URL, so `localhost` cannot be used for a live post.

## Docker

```bash
docker compose up --build
```

Compose starts the web app, API, and worker. A named volume persists SQLite, the queue, and media files; local Google Cloud credentials are mounted read-only when present.

## Railway

Production is packaged as one Railway service so FastAPI and the Huey worker share SQLite, the queue, and media files. `Dockerfile.railway` builds the React app and `railway.toml` configures the `/health` deployment check.

Mount a persistent volume at `/data` and configure:

```text
DATA_DIR=/data
WEB_DIST_DIR=/app/web
FRONTEND_URL=https://your-domain.example
CORS_ORIGINS=https://your-domain.example
INSTAGRAM_REDIRECT_URI=https://your-domain.example/api/platforms/instagram/callback
PUBLIC_BASE_URL=https://your-domain.example
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
TOKEN_ENCRYPTION_KEY=...
GOOGLE_CLOUD_PROJECT=...
GOOGLE_SERVICE_ACCOUNT_JSON={...}
```

Keep `TOKEN_ENCRYPTION_KEY` stable between deployments, keep all credentials in secret variables, and make the Instagram redirect URI exactly match the one registered with Meta.

## Development Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install web and API dependencies |
| `npm start` | Run the web app, API, and worker together |
| `make dev-web` | Run only the Vite development server |
| `make dev-api` | Run only FastAPI with reload enabled |
| `make dev-worker` | Run only the Huey worker |
| `make test` | Run the API and web test suites |
| `make build` | Type-check and build the production web app |
| `npm run lint` | Type-check the web app |

## Repository Guide

```text
apps/api/        API, worker, migrations, render pipeline, fonts, and tests
apps/web/        React application, editors, mode registry, and UI tests
docs/adr/        Architecture decision records for the current product model
CONTEXT.md       The product glossary used throughout the codebase
compose.yaml     Local container stack
Dockerfile.railway
railway.toml     Single-service production deployment
```

The most important product terms—Clip, Batch, Sequence, Shot, Cutaway, Title, Subtitle, Caption, Render, and Publication—are defined in `CONTEXT.md`.
