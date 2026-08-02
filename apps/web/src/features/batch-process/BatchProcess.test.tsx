import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from '../../App'
import type { Batch, BatchSummary, Project, SequenceRender } from '../../types'

function LocationDisplay() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderApp(client: QueryClient, initialEntry = '/') {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[initialEntry]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeClip(overrides: Partial<Project> & { id: string; title: string }): Project {
  return {
    mode: 'batch-process',
    origin_kind: 'upload',
    batch_id: 'batch-1',
    source_url: null,
    source_post_id: null,
    source_caption: null,
    social_caption: null,
    status: 'ready',
    transcription_status: 'complete',
    error_message: null,
    duration_ms: 5000,
    width: 1920,
    height: 1080,
    fps: 30,
    trim_start_ms: 0,
    trim_end_ms: 5000,
    layout: 'fit_background',
    crop_center_x: 50,
    captions_enabled: true,
    caption_style: 'bold',
    caption_position: 'bottom',
    created_at: '2026-08-02T12:00:00Z',
    updated_at: '2026-08-02T12:01:00Z',
    artifacts: [],
    captions: [],
    image_overlays: [],
    renders: [],
    latest_job: null,
    ...overrides,
  }
}

const summary: BatchSummary = {
  id: 'batch-1',
  name: 'Tuesday pulls',
  created_at: '2026-08-02T12:00:00Z',
  updated_at: '2026-08-02T12:00:00Z',
  clip_count: 2,
  importing_count: 1,
  failed_count: 0,
  shot_count: 0,
}

const importingClip = makeClip({
  id: 'clip-importing',
  title: 'second',
  status: 'processing',
  duration_ms: null,
  latest_job: {
    id: 'job-2',
    project_id: 'clip-importing',
    render_id: null,
    kind: 'import',
    status: 'running',
    progress: 40,
    message: 'Building editor preview',
    attempts: 1,
    error_message: null,
    created_at: '2026-08-02T12:00:00Z',
    started_at: '2026-08-02T12:00:05Z',
    completed_at: null,
  },
})

const batch: Batch = {
  id: 'batch-1',
  name: 'Tuesday pulls',
  created_at: '2026-08-02T12:00:00Z',
  updated_at: '2026-08-02T12:00:00Z',
  clips: [makeClip({ id: 'clip-ready', title: 'first' }), importingClip],
  shots: [],
  sequence_render: null,
}

function stubApi(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const key = `${init?.method ?? 'GET'} ${path}`
    if (key in overrides) return { ok: true, json: async () => overrides[key] }
    if (path === '/api/batches') return { ok: true, json: async () => [summary] }
    if (path === '/api/batches/batch-1') return { ok: true, json: async () => batch }
    if (path === '/api/platforms') return { ok: true, json: async () => [] }
    return { ok: true, json: async () => [] }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

test('offers batch process alongside the X mode on the home page', async () => {
  stubApi()

  renderApp(newClient())

  expect(screen.getByText('Mode library · 02 available')).toBeInTheDocument()
  expect(screen.getByText(/Upload a set of videos at once/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Batch Process/ }))

  expect(screen.getByTestId('location')).toHaveTextContent('/modes/batch-process')
})

test('opens the most recent batch and shows per-clip import progress', async () => {
  stubApi()

  renderApp(newClient(), '/modes/batch-process')

  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/modes/batch-process/batches/batch-1'),
  )
  expect(await screen.findByRole('heading', { name: /Tuesday pulls/ })).toBeVisible()

  // Each clip imports behind its own job, so progress is shown per clip.
  const grid = screen.getByRole('list', { name: 'Clips in this batch' })
  expect(within(grid).getByText('Building editor preview')).toBeVisible()
  expect(within(grid).getByRole('progressbar', { name: 'second import progress' }))
    .toHaveAttribute('aria-valuenow', '40')

  // A clip that is still importing cannot be opened yet.
  expect(within(grid).getByRole('button', { name: /second is still importing/ })).toBeDisabled()
  expect(within(grid).getByRole('button', { name: /Edit first/ })).toBeEnabled()
})

test('adds several videos to a batch in one upload', async () => {
  const fetchMock = stubApi({
    'POST /api/batches/batch-1/uploads': { batch, accepted: 2, rejected: [] },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]')
    if (!found) throw new Error('no file input')
    return found as HTMLInputElement
  })
  expect(input.multiple).toBe(true)

  fireEvent.change(input, {
    target: {
      files: [
        new File(['a'], 'one.mp4', { type: 'video/mp4' }),
        new File(['b'], 'two.mov', { type: 'video/quicktime' }),
      ],
    },
  })

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/uploads',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
  const [, init] = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/uploads'))!
  const body = (init as RequestInit).body as FormData
  expect(body.getAll('videos')).toHaveLength(2)
})

test('reports files that could not become clips without losing the rest', async () => {
  stubApi({
    'POST /api/batches/batch-1/uploads': {
      batch,
      accepted: 1,
      rejected: ['notes.pdf is not a video Clip Farm can read.'],
    },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]')
    if (!found) throw new Error('no file input')
    return found as HTMLInputElement
  })
  fireEvent.change(input, {
    target: { files: [new File(['a'], 'notes.pdf', { type: 'application/pdf' })] },
  })

  expect(await screen.findByRole('alert')).toHaveTextContent('notes.pdf is not a video')
})

test('edits a clip inside a batch and keeps the batch rail beside it', async () => {
  stubApi()

  renderApp(newClient(), '/modes/batch-process/batches/batch-1/clips/clip-ready')

  expect(await screen.findByRole('heading', { name: 'first' })).toBeVisible()
  // An uploaded clip has no origin post to link back to.
  expect(screen.getByText('Uploaded video')).toBeVisible()
  expect(screen.queryByTitle('Open source post')).not.toBeInTheDocument()
  // The rail lists this batch's clips, not the loose ones.
  expect(screen.getByText('Tuesday pulls')).toBeVisible()
  expect(screen.getByRole('button', { name: /Add videos/ })).toBeVisible()
  // A batch is cleared by deleting the batch, so there is no clear-all here.
  expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
})

test('starts a new batch so several can run in parallel', async () => {
  const created: Batch = { ...batch, id: 'batch-2', name: 'Untitled batch', clips: [] }
  const fetchMock = stubApi({
    'POST /api/batches': created,
    'GET /api/batches/batch-2': created,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /New batch/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/batches', expect.objectContaining({ method: 'POST' })),
  )
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/modes/batch-process/batches/batch-2'),
  )
})

test('deletes a batch after confirmation, once nothing in it is importing', async () => {
  const fetchMock = stubApi({
    'DELETE /api/batches/batch-1': { deleted: 2 },
    // A batch mid-import cannot be deleted, so settle it first.
    'GET /api/batches': [{ ...summary, importing_count: 0 }],
    'GET /api/batches/batch-1': { ...batch, clips: [makeClip({ id: 'clip-ready', title: 'first' })] },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: 'Delete Tuesday pulls' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('Delete this batch?')
  expect(dialog).toHaveTextContent('“Tuesday pulls” and its 2 clips')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete batch' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

test('renames a batch in place', async () => {
  const fetchMock = stubApi({ 'PATCH /api/batches/batch-1': { ...batch, name: 'Client cuts' } })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: 'Rename Tuesday pulls' }))
  const field = screen.getByLabelText('Batch name')
  fireEvent.change(field, { target: { value: 'Client cuts' } })
  fireEvent.keyDown(field, { key: 'Enter' })

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Client cuts' }) }),
    ),
  )
})

// --- the timeline, and the one video it exports --------------------------

const readyClip = makeClip({ id: 'clip-ready', title: 'first' })
const secondClip = makeClip({ id: 'clip-second', title: 'second', duration_ms: 3000, trim_end_ms: 3000 })

/** A batch whose clips have all imported, so they can be placed and exported. */
function sequencedBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    ...batch,
    clips: [readyClip, secondClip],
    shots: [],
    sequence_render: null,
    ...overrides,
  }
}

const placed: Batch = sequencedBatch({
  shots: [
    { id: 'shot-1', clip_id: 'clip-ready', position: 0 },
    { id: 'shot-2', clip_id: 'clip-second', position: 1 },
  ],
})

test('an imported clip waits off the timeline until it is added', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': sequencedBatch() })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  // In the batch, but not yet in the sequence.
  expect(await screen.findByText(/Nothing on the timeline yet/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Add first to the timeline' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clip_id: 'clip-ready' }),
      }),
    ),
  )
})

test('shows the placed clips in order with a running total', async () => {
  stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const timeline = await screen.findByRole('list', { name: 'Timeline' })
  const entries = within(timeline).getAllByRole('listitem')
  expect(entries).toHaveLength(2)
  expect(entries[0]).toHaveTextContent('first')
  expect(entries[1]).toHaveTextContent('second')
  // 5s + 3s of trimmed clip, not the raw sources.
  expect(screen.getByRole('heading', { name: /2 clips/ })).toHaveTextContent('0:08')
  // A clip already placed is not offered again.
  expect(screen.queryByRole('button', { name: 'Add first to the timeline' })).toBeNull()
})

test('reorders the timeline by position rather than by swap', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: 'Move second earlier' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-2',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ position: 0 }) }),
    ),
  )
})

test('the first clip cannot move earlier and the last cannot move later', async () => {
  stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  expect(await screen.findByRole('button', { name: 'Move first earlier' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move second later' })).toBeDisabled()
})

test('removing a clip from the timeline leaves it in the batch', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: 'Remove first from the timeline' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  // Still in the grid, ready to add back.
  expect(screen.getByRole('button', { name: 'Edit first' })).toBeVisible()
})

test('exporting is refused until something is on the timeline', async () => {
  stubApi({ 'GET /api/batches/batch-1': sequencedBatch() })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  expect(await screen.findByRole('button', { name: /Export video/ })).toBeDisabled()
})

test('exports the timeline as one video', async () => {
  const queued: SequenceRender = {
    id: 'seq-1',
    batch_id: 'batch-1',
    status: 'queued',
    progress: 0,
    message: 'Queued for export',
    size_bytes: null,
    duration_ms: null,
    shot_count: 2,
    error_message: null,
    created_at: '2026-08-02T12:00:00Z',
    completed_at: null,
    download_url: null,
  }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': placed,
    'POST /api/batches/batch-1/render': queued,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /Export video/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/render',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
})

test('shows export progress while the sequence renders', async () => {
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: {
        id: 'seq-1',
        batch_id: 'batch-1',
        status: 'running',
        progress: 45,
        message: 'Rendering clip 1 of 2',
        size_bytes: null,
        duration_ms: null,
        shot_count: 2,
        error_message: null,
        created_at: '2026-08-02T12:00:00Z',
        completed_at: null,
        download_url: null,
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const bar = await screen.findByRole('progressbar', { name: 'Export progress' })
  expect(bar).toHaveAttribute('aria-valuenow', '45')
  expect(screen.getByText('Rendering clip 1 of 2')).toBeVisible()
  expect(screen.getByRole('button', { name: /Exporting/ })).toBeDisabled()
})

test('offers the finished video for download, and flags a timeline changed since', async () => {
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: {
        id: 'seq-1',
        batch_id: 'batch-1',
        status: 'complete',
        progress: 100,
        message: 'Sequence ready',
        size_bytes: 4_200_000,
        duration_ms: 8000,
        // Rendered from one clip; the timeline now holds two.
        shot_count: 1,
        error_message: null,
        created_at: '2026-08-02T12:00:00Z',
        completed_at: '2026-08-02T12:02:00Z',
        download_url: '/api/batches/batch-1/render/download',
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const link = await screen.findByRole('link', { name: /Download MP4/ })
  expect(link).toHaveAttribute('href', '/api/batches/batch-1/render/download')
  expect(screen.getByText(/timeline changed since this export/)).toBeVisible()
})

test('reports a failed export instead of a download', async () => {
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: {
        id: 'seq-1',
        batch_id: 'batch-1',
        status: 'failed',
        progress: 40,
        message: 'Export failed while rendering clip 2 of 2',
        size_bytes: null,
        duration_ms: null,
        shot_count: 2,
        error_message: 'Stage: Rendering clip 2 of 2',
        created_at: '2026-08-02T12:00:00Z',
        completed_at: '2026-08-02T12:01:00Z',
        download_url: null,
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  expect(await screen.findByRole('alert')).toHaveTextContent('Export failed while rendering clip 2 of 2')
  expect(screen.queryByRole('link', { name: /Download MP4/ })).toBeNull()
})
