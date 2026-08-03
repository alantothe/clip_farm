import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from '../../App'
import type { Batch, BatchSummary, Project, SequenceRender, Shot } from '../../types'

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
  format: 'vertical',
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
  format: 'vertical',
  created_at: '2026-08-02T12:00:00Z',
  updated_at: '2026-08-02T12:00:00Z',
  clips: [makeClip({ id: 'clip-ready', title: 'first' }), importingClip],
  shots: [],
  cutaways: [],
  titles: [],
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

test('the video bin folds away and gives the Player its width back', async () => {
  stubApi()

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  await screen.findByRole('button', { name: 'Collapse video bin' })
  const bin = document.querySelector<HTMLElement>('.clip-bin')!
  expect(within(bin).getByRole('heading', { name: 'Tuesday pulls' })).toBeVisible()
  expect(within(bin).getByRole('button', { name: 'Choose videos' })).toBeVisible()

  fireEvent.click(within(bin).getByRole('button', { name: 'Collapse video bin' }))

  expect(bin).toHaveClass('clip-bin--collapsed')
  expect(within(bin).queryByRole('heading', { name: 'Tuesday pulls' })).toBeNull()
  expect(within(bin).queryByRole('button', { name: 'Choose videos' })).toBeNull()

  fireEvent.click(within(bin).getByRole('button', { name: 'Expand video bin' }))
  expect(bin).not.toHaveClass('clip-bin--collapsed')
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
  // The batch is not made on that click: the Format has to be settled first,
  // and it can never be changed afterwards (ADR 0006).
  expect(fetchMock).not.toHaveBeenCalledWith('/api/batches', expect.objectContaining({ method: 'POST' }))

  fireEvent.click(await screen.findByRole('button', { name: 'Create batch' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/batches', expect.objectContaining({ method: 'POST' })),
  )
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/modes/batch-process/batches/batch-2'),
  )
})

test('a new batch is created in the format the operator picked', async () => {
  const created: Batch = { ...batch, id: 'batch-2', name: 'Reels drop', clips: [] }
  const fetchMock = stubApi({
    'POST /api/batches': created,
    'GET /api/batches/batch-2': created,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: /New batch/ }))

  const dialog = await screen.findByRole('dialog', { name: /What are you making/ })
  // Vertical is the only Format today, and it is already the chosen one.
  expect(within(dialog).getByRole('button', { name: /Instagram/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Reels drop' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create batch' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Reels drop', format: 'vertical' }),
      }),
    ),
  )
})

test('the new batch dialog can be dismissed without making one', async () => {
  const fetchMock = stubApi({})

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: /New batch/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: /What are you making/ })).not.toBeInTheDocument(),
  )
  expect(fetchMock).not.toHaveBeenCalledWith('/api/batches', expect.objectContaining({ method: 'POST' }))
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
    cutaways: [],
    sequence_render: null,
    ...overrides,
  }
}

function makeShot(overrides: Partial<Shot> & Pick<Shot, 'id' | 'clip_id' | 'position'>): Shot {
  return {
    trim_start_ms: null,
    trim_end_ms: null,
    frame_zoom: 1,
    frame_center_x: 50,
    frame_center_y: 50,
    ...overrides,
  }
}

const placed: Batch = sequencedBatch({
  shots: [
    makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0 }),
    makeShot({ id: 'shot-2', clip_id: 'clip-second', position: 1 }),
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

test('draws each shot as wide as it is long, and names it', async () => {
  stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const timeline = await screen.findByRole('list', { name: 'Timeline' })
  const entries = within(timeline).getAllByRole('listitem')
  expect(entries).toHaveLength(2)
  // Horizontal space is time: 5s then 3s, at the default scale.
  expect(entries[0]).toHaveStyle({ left: '0px', width: '120px' })
  expect(entries[1]).toHaveStyle({ left: '120px', width: '72px' })
  // A shot too narrow to hold its title still says what it is.
  expect(within(timeline).getByRole('button', { name: 'first, shot 1 of 2, 00:05.0' })).toBeVisible()
  expect(within(timeline).getByRole('button', { name: 'second, shot 2 of 2, 00:03.0' })).toBeVisible()
  // Batch and timeline facts now live in the video bin instead of a top bar.
  const bin = document.querySelector('.clip-bin')!
  expect(bin).toHaveTextContent('2 videos · 2 on timeline')
  expect(bin).toHaveTextContent('00:08.0')
})

test('a clip already on the timeline can be placed again', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  // The old timeline swapped this button for a badge; a clip can repeat now.
  const add = await screen.findByRole('button', { name: 'Add first to the timeline' })
  expect(add).toBeEnabled()
  expect(screen.getAllByText('On the timeline').length).toBeGreaterThan(0)
  fireEvent.click(add)

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

/** Selecting a Shot is what opens the controls that dragging cannot reach. */
async function selectShot(name: RegExp) {
  const timeline = await screen.findByRole('list', { name: 'Timeline' })
  fireEvent.focus(within(timeline).getByRole('button', { name }))
}

test('reorders the timeline by position rather than by swap', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/second, shot 2 of 2/)

  fireEvent.click(screen.getByRole('button', { name: 'Move second earlier' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-2',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ position: 0 }) }),
    ),
  )
})

test('the first shot cannot move earlier and the last cannot move later', async () => {
  stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  await selectShot(/first, shot 1 of 2/)
  expect(screen.getByRole('button', { name: 'Move first earlier' })).toBeDisabled()
  await selectShot(/second, shot 2 of 2/)
  expect(screen.getByRole('button', { name: 'Move second later' })).toBeDisabled()
})

test('trimming a shot sends only the edge that moved', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 2/)

  const out = screen.getByRole('spinbutton', { name: 'Shot out point, seconds' })
  fireEvent.change(out, { target: { value: '3.5' } })
  fireEvent.blur(out)

  // The in point is untouched, so it keeps following the clip rather than
  // being frozen at its current value.
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ trim_end_ms: 3500 }) }),
    ),
  )
})

test('a selected shot can be zoomed and positioned in the finished frame', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 2/)

  const zoom = screen.getByRole('slider', { name: 'Shot zoom' })
  const horizontal = screen.getByRole('slider', { name: 'Shot horizontal position' })
  const vertical = screen.getByRole('slider', { name: 'Shot vertical position' })
  expect(horizontal).toHaveValue('50')
  expect(vertical).toHaveValue('50')

  fireEvent.change(zoom, { target: { value: '175' } })
  const activeVideo = document.querySelector<HTMLElement>('.player__video.is-active')!
  expect(activeVideo.style.getPropertyValue('--frame-zoom')).toBe('1.75')
  fireEvent.pointerUp(zoom)

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          frame_zoom: 1.75,
          frame_center_x: 50,
          frame_center_y: 50,
        }),
      }),
    ),
  )
})

test('the Player border can be pulled directly to zoom a selected shot', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': placed })
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 2/)

  const cage = screen.getByLabelText('Framing controls for first')
  expect(within(cage).getByText('Drag edge · pull corner')).toBeVisible()
  const stage = document.querySelector<HTMLElement>('.player__stage')!
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 533, right: 300, bottom: 533 }) as DOMRect
  const corner = cage.querySelector<HTMLElement>('.player__framing-corner--se')!

  fireEvent.pointerDown(corner, { pointerId: 1, clientX: 290, clientY: 523 })
  fireEvent.pointerMove(corner, { pointerId: 1, clientX: 330, clientY: 580 })
  const activeVideo = document.querySelector<HTMLElement>('.player__video.is-active')!
  expect(Number(activeVideo.style.getPropertyValue('--frame-zoom'))).toBeGreaterThan(1)
  fireEvent.pointerUp(corner, { pointerId: 1, clientX: 330, clientY: 580 })

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/batches/batch-1/shots/shot-1' && options?.method === 'PATCH',
    )
    expect(call).toBeTruthy()
    const body = JSON.parse(String(call?.[1]?.body))
    expect(body.frame_zoom).toBeGreaterThan(1)
    expect(body.frame_center_x).toBe(50)
    expect(body.frame_center_y).toBe(50)
  })
})

test('a shot trimmed on the timeline can be reset to follow its clip', async () => {
  const trimmed = sequencedBatch({
    shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0, trim_end_ms: 2000 })],
  })
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': trimmed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 1/)
  expect(screen.getByText(/trimmed here/)).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: "Reset first to its clip's trim" }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ trim_start_ms: null, trim_end_ms: null }),
      }),
    ),
  )
})

test('reset is offered only to a shot that has its own trim', async () => {
  stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 2/)

  expect(screen.getByText(/follows clip/)).toBeVisible()
  expect(screen.getByRole('button', { name: "Reset first to its clip's trim" })).toBeDisabled()
})

test('removing a shot leaves the clip in the batch, and offers an undo', async () => {
  const trimmed = sequencedBatch({
    shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0, trim_start_ms: 500 })],
  })
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': trimmed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 1/)

  fireEvent.click(screen.getByRole('button', { name: 'Remove first from the timeline' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  // Still in the grid, ready to add back.
  expect(screen.getByRole('button', { name: 'Edit first' })).toBeVisible()

  // Removing is the one gesture that discards a trim a re-drag would not
  // restore, so undo puts the shot back where it was, trimmed as it was.
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clip_id: 'clip-ready',
          position: 0,
          trim_start_ms: 500,
          trim_end_ms: null,
          frame_zoom: 1,
          frame_center_x: 50,
          frame_center_y: 50,
        }),
      }),
    ),
  )
})

test('plays the sequence as a rough cut, and says that is what it is', async () => {
  stubApi({ 'GET /api/batches/batch-1': placed })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const preview = await screen.findByRole('region', { name: 'Player' })
  // These clips are fitted whole, so the framing on the stage is what the
  // export produces and there is nothing to warn about. The caveat is not
  // wallpaper — it appears only where it is true (ADR 0007).
  expect(within(preview).queryByText(/Approximate/)).not.toBeInTheDocument()
  expect(within(preview).getByText('first')).toBeInTheDocument()
  expect(within(preview).getByText('shot 1 of 2')).toBeInTheDocument()
  expect(within(preview).getByText('00:00:00 / 00:08:00')).toBeVisible()
  expect(within(preview).getByRole('button', { name: 'Play the rough cut' })).toBeEnabled()
})

test('the transport is dead until something is placed', async () => {
  stubApi({ 'GET /api/batches/batch-1': sequencedBatch() })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const preview = await screen.findByRole('region', { name: 'Player' })
  expect(within(preview).getByRole('button', { name: 'Play the rough cut' })).toBeDisabled()
  expect(within(preview).queryByText('Nothing placed yet.')).not.toBeInTheDocument()
})

const covered: Batch = sequencedBatch({
  shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0 })],
  cutaways: [
    {
      id: 'cut-1',
      clip_id: 'clip-second',
      base_shot_id: 'shot-1',
      offset_ms: 1_000,
      trim_start_ms: null,
      trim_end_ms: null,
      frame_zoom: 1,
      frame_center_x: 50,
      frame_center_y: 50,
    },
  ],
})

test('a cutaway sits on its own lane, over the shot it covers', async () => {
  stubApi({ 'GET /api/batches/batch-1': covered })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const lane = await screen.findByRole('list', { name: 'Cutaways' })
  const entries = within(lane).getAllByRole('listitem')
  expect(entries).toHaveLength(1)
  // 1.0s into a shot that starts at 0, and 3s long, at the default scale.
  expect(entries[0]).toHaveStyle({ left: '24px', width: '72px' })
  // It is not in the running order.
  const timeline = screen.getByRole('list', { name: 'Timeline' })
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(1)
})

test('a cutaway is trimmed and uncovered from the same inspector', async () => {
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': covered })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  const lane = await screen.findByRole('list', { name: 'Cutaways' })
  fireEvent.focus(within(lane).getByRole('button', { name: /second, cutaway covering/ }))

  // It says what it covers rather than a place in an order it is not in.
  expect(screen.getByText(/covering first/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Move second earlier' })).toBeNull()

  const out = screen.getByRole('spinbutton', { name: 'Shot out point, seconds' })
  fireEvent.change(out, { target: { value: '2' } })
  fireEvent.blur(out)

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/cutaways/cut-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ trim_end_ms: 2000 }) }),
    ),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Stop second covering first' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/cutaways/cut-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

test('the rough cut says a cutaway is playing over the sound beneath it', async () => {
  // Covering from the very start, so it is live at the opening playhead —
  // scrubbing into it needs pointer geometry jsdom cannot run.
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0 })],
      cutaways: [
        {
          id: 'cut-1',
          clip_id: 'clip-second',
          base_shot_id: 'shot-1',
          offset_ms: 0,
          trim_start_ms: null,
          trim_end_ms: null,
          frame_zoom: 1,
          frame_center_x: 50,
          frame_center_y: 50,
        },
      ],
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const preview = await screen.findByRole('region', { name: 'Player' })
  // The cover supplies the picture; the shot underneath keeps the sound, which
  // is the one thing a cutaway changes and the preview must not misreport.
  expect(within(preview).getByText('second')).toBeInTheDocument()
  expect(within(preview).getByText('covering first, its sound playing')).toBeInTheDocument()
})

test('exporting is refused until something is on the timeline', async () => {
  stubApi({ 'GET /api/batches/batch-1': sequencedBatch() })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const player = await screen.findByRole('region', { name: 'Player' })
  const exportButton = within(player).getByRole('button', { name: /Export video/ })
  expect(exportButton).toBeDisabled()
  expect(exportButton).toHaveAttribute('title', 'Add clips to the timeline before exporting')
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
  expect(screen.getByRole('tooltip', { name: /Rendering clip 1 of 2/ })).toBeInTheDocument()
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
  expect(screen.getByText(/timeline changed since this export/i)).toBeInTheDocument()
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

test('a clip inside a batch edits but does not render or publish on its own', async () => {
  stubApi({ 'GET /api/batches/batch-1': sequencedBatch() })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1/clips/clip-ready')

  // The editing controls are all still there — a batch holds no edit settings.
  expect(await screen.findByTitle('Save edits')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'first' })).toBeVisible()
  // The batch is the deliverable, so the clip offers no output of its own.
  expect(screen.queryByRole('button', { name: /Render vertical/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Post to Instagram/ })).toBeNull()
})
