# Clip Farm

Clip Farm converts authorized landscape video into 1080x1920 MP4s for manual upload to Instagram Reels or TikTok. Two modes on the home page decide how video gets in.

## Landscape X to Vertical

1. Paste an `x.com/.../status/...` link.
2. Wait for `yt-dlp` import, X post-text extraction, preview generation, and optional Google Speech-to-Text captions.
3. Choose Smart Crop or Full Frame, adjust trim and captions, and optionally create a brand-safe Instagram caption with Gemini.
4. Preview and download the vertical MP4.

## Batch Process

1. Start a batch — a named set of clips worked on together.
2. Drop in several videos, or pick them from a file dialog. Each becomes its own clip and imports on its own, so the grid shows several imports running at once.
3. Open any clip in the same editor the X mode uses, then render and publish it.

Batches are independent, so several can be in flight at the same time. See `docs/adr/0002-batches-group-clips-for-parallel-work.md` for why a batch holds no shared edit settings.

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

## Connect Instagram

Clip Farm uses the Instagram API with Instagram Login for professional Business
and Creator accounts. In the Meta developer dashboard:

1. Create a Business app and add the Instagram product.
2. Configure Business Login for Instagram with these permissions:
   `instagram_business_basic` and `instagram_business_content_publish`.
3. Register `http://localhost:8000/api/platforms/instagram/callback` as the
   OAuth redirect URI for local development.
4. Copy the Instagram app ID and app secret into `apps/api/.env`.
5. Generate `TOKEN_ENCRYPTION_KEY` using the command documented in
   `apps/api/.env.example`. Keep this key stable; changing it invalidates stored
   account credentials.

Restart the API and open **Settings → Connected Apps → Connect Instagram**.
Clip Farm stores the returned long-lived access token encrypted in SQLite and
never returns it to the browser.

## Publish an Instagram Reel

Instagram publishing runs entirely through the backend and Huey worker. After
a vertical render completes, use **Post to Instagram** in the editor. Clip Farm
creates a one-hour HMAC-signed MP4 URL, asks Instagram to create a Reel
container, waits for processing, and then publishes it. The UI reports the
worker job status and links to the published Reel when Meta returns a permalink.

For deployment, set `PUBLIC_BASE_URL` to the public HTTPS origin that serves the
API (for example, `https://clip-farm-production.up.railway.app`). It must be
reachable by Meta; `localhost` cannot be used for a real test post. Publishing
automatically refreshes a long-lived token when it is within seven days of
expiration, and the worker also checks it daily.

Test the live flow in this order:

1. Open **Settings** and confirm the Instagram username shows as connected.
2. Complete a vertical render that is at least three seconds long.
3. Review the Post-tab caption and **Also share to feed** option.
4. Click **Post to Instagram** once and keep the worker running while Meta
   processes the video.
5. Wait for **Reel posted to Instagram**, then open the returned Reel link.

To run processes separately, use `make dev-api`, `make dev-worker`, and
`make dev-web` in three terminals.

## Docker

```bash
docker compose up --build
```

The Compose setup persists SQLite and media in a named volume and mounts local gcloud credentials read-only. The API is available at `http://localhost:8000`, with OpenAPI at `/docs`.

## Railway

Production runs as one Railway service so the API and Huey worker share the
same SQLite database, queue, and media files. `Dockerfile.railway` builds the
React app and starts both Python processes; `railway.toml` configures the
`/health` deployment check. Mount a persistent Railway volume at `/data`.

Set these service variables before deploying:

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

Keep `TOKEN_ENCRYPTION_KEY` stable between deployments. The Instagram redirect
URI must exactly match the URI registered in the Meta developer dashboard.
Store `GOOGLE_SERVICE_ACCOUNT_JSON` as a secret variable containing the entire
service-account key JSON. Grant that account only the permissions the enabled
features require (at minimum, Cloud Speech Client for automatic captions, plus
Vertex AI User for Gemini rewrites). Prefer workload identity federation over a
long-lived service-account key when the deployment platform supports it.

## Verification

```bash
make test
make build
```

The Post editor retains the original X post text and a separate upload-caption draft. Gemini can reword that draft and mask profanity while preserving text inside direct double quotes exactly.
