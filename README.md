# Clip Farm

Clip Farm converts an authorized landscape video from an individual X post into a 1080x1920 MP4 for manual upload to Instagram Reels or TikTok.

## Current Workflow

1. Paste an `x.com/.../status/...` link.
2. Wait for `yt-dlp` import, X post-text extraction, preview generation, and optional Google Speech-to-Text captions.
3. Choose Smart Crop or Full Frame, adjust trim and captions, and optionally create a brand-safe Instagram caption with Gemini.
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

Set `GOOGLE_CLOUD_PROJECT` in `apps/api/.env`. A `GCS_BUCKET` is optional: when configured, long videos use one Speech-to-Text batch job; otherwise, Clip Farm transcribes them locally in 55-second chunks through the synchronous API. The app remains usable without Google configuration, but automatic speech captions and Gemini social-caption rewrites require Google Application Default Credentials. `GEMINI_MODEL` defaults to `gemini-2.5-flash`.

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

The Post editor retains the original X post text and a separate upload-caption draft. Gemini can reword that draft and mask profanity while preserving text inside direct double quotes exactly.
