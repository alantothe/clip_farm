# Clip Farm

Clip Farm converts an authorized landscape video from an individual X post into a 1080x1920 MP4 for manual upload to Instagram Reels or TikTok.

## Current Workflow

1. Paste an `x.com/.../status/...` link.
2. Wait for `yt-dlp` import, preview generation, and optional Google Speech-to-Text captions.
3. Choose Smart Crop or Full Frame, adjust trim and captions, then render.
4. Preview and download the vertical MP4.

Only process videos you own or have permission to repurpose.

## Repository Layout

This is a polyglot monorepo managed with npm workspaces and `uv`:

```text
apps/
  api/  Python API and background worker
  web/  React/Vite frontend
```

## Local Setup

Prerequisites: Python 3.12, `uv`, Node 18+, FFmpeg/FFprobe, and Google Application Default Credentials for automatic captions.

```bash
npm run setup
cp apps/api/.env.example apps/api/.env
```

Set `GOOGLE_CLOUD_PROJECT` in `apps/api/.env`. For videos at least 60 seconds long, also set a `GCS_BUCKET` that the current Google identity can access. The app remains usable without Google configuration, but automatic captioning will report a retryable error.

Start the frontend, API, and worker together from the repository root:

```bash
npm start
```

Open `http://localhost:5173`.

To run processes separately, use `make dev-api`, `make dev-worker`, and
`make dev-web` in three terminals.

## Docker

```bash
docker compose up --build
```

The Compose setup persists SQLite and media in a named volume and mounts local gcloud credentials read-only. The API is available at `http://localhost:8000`, with OpenAPI at `/docs`.

## Verification

```bash
make test
make build
```

Gemini is intentionally outside the MVP processing path. The existing Google Cloud authentication can support a later `google-genai` integration for optional title, description, and hashtag suggestions.
