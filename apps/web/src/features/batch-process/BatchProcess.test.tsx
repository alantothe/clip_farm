import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from '../../App'
import type {
  Batch,
  BatchMedia,
  BatchSummary,
  LayerProfile,
  Project,
  SequenceRender,
  Shot,
  Title,
} from '../../types'

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
  media: [],
  sequence_render: null,
  sequence_publications: [],
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

  expect(screen.getByText('Mode library · 03 available')).toBeInTheDocument()
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

  // Import does not prevent selection or deletion staging, but placement and
  // deletion remain unavailable until the files are no longer moving.
  expect(within(grid).getByRole('button', { name: 'Select second' })).toBeEnabled()
  expect(within(grid).getByRole('button', { name: 'Add second to the timeline' })).toBeDisabled()
  expect(within(grid).getByRole('button', { name: 'Delete second' })).toBeDisabled()
  expect(within(grid).getByRole('button', { name: 'Select first' })).toBeEnabled()
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

const sequenceImage: BatchMedia = {
  id: 'media-1',
  batch_id: 'batch-1',
  name: 'brand-mark.png',
  start_ms: 0,
  end_ms: 8000,
  center_x: 50,
  center_y: 50,
  width_percent: 65,
  rotation_deg: 0,
  opacity: 1,
  mime_type: 'image/png',
  size_bytes: 2048,
  url: '/api/batches/batch-1/media/media-1/file',
  applied_profile_id: null,
}

const sequenceTitle: Title = {
  id: 'title-1',
  batch_id: 'batch-1',
  applied_profile_id: null,
  text: 'Follow for more',
  start_ms: 0,
  end_ms: 8000,
  style_id: null,
  font_family: 'anton',
  font_weight: 900,
  italic: false,
  uppercase: true,
  font_size_percent: 6,
  letter_spacing: 0,
  color: '#FFFFFF',
  opacity: 1,
  align: 'center',
  outline_color: '#000000',
  outline_width: 0.08,
  shadow_color: '#000000',
  shadow_offset: 0,
  background: 'none',
  background_color: '#000000',
  background_opacity: 0.7,
  background_padding: 0.25,
  center_x: 50,
  center_y: 20,
  width_percent: 80,
  rotation_deg: 0,
}

const layerProfile: LayerProfile = {
  id: 'profile-1',
  name: 'Brand close',
  created_at: '2026-08-03T12:00:00Z',
  updated_at: '2026-08-03T12:00:00Z',
  titles: [{
    ...sequenceTitle,
    id: 'profile-title-1',
    batch_id: undefined,
    start_ms: undefined,
    end_ms: undefined,
    style_id: undefined,
  } as unknown as LayerProfile['titles'][number]],
  media: [{
    id: 'profile-media-1',
    name: sequenceImage.name,
    mime_type: sequenceImage.mime_type,
    size_bytes: sequenceImage.size_bytes,
    center_x: sequenceImage.center_x,
    center_y: sequenceImage.center_y,
    width_percent: sequenceImage.width_percent,
    rotation_deg: sequenceImage.rotation_deg,
    opacity: sequenceImage.opacity,
    url: '/api/layer-profiles/profile-1/media/profile-media-1/file',
  }],
}

const storedImage = {
  id: 'stored-1',
  name: 'brand-mark.png',
  mime_type: 'image/png',
  size_bytes: 2048,
  created_at: '2026-08-03T12:00:00Z',
  updated_at: '2026-08-03T12:00:00Z',
  url: '/api/storage/images/stored-1/file',
}

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

test('previews clips in a closeable modal, then adds the preserved selection in list order', async () => {
  const previewable = sequencedBatch({
    clips: [
      makeClip({
        id: 'clip-ready',
        title: 'first',
        artifacts: [{
          id: 'preview-first',
          kind: 'preview',
          mime_type: 'video/mp4',
          size_bytes: 1024,
          url: '/api/media/first-preview.mp4',
        }],
      }),
      secondClip,
    ],
  })
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': previewable,
    'POST /api/batches/batch-1/shots': previewable,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const first = await screen.findByRole('button', { name: 'Select first' })
  fireEvent.click(first)
  expect(screen.getByTestId('location')).toHaveTextContent('/modes/batch-process/batches/batch-1')
  expect(screen.getByRole('dialog', { name: 'first' })).toBeVisible()
  expect(screen.getByLabelText('first preview')).toHaveAttribute(
    'src',
    '/api/media/first-preview.mp4',
  )
  expect(screen.getByRole('button', { name: 'Close video preview' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Edit video' }))
  expect(screen.getByTestId('location')).toHaveTextContent(
    '/modes/batch-process/batches/batch-1/clips/clip-ready',
  )

  // The preview is still the way back to editing after selection was added.
  fireEvent.click(screen.getByRole('button', { name: /Add videos/ }))
  expect(screen.getByRole('dialog', { name: 'first' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Close video preview' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  // Closing the viewer does not throw away the staging selection.
  expect(screen.getByRole('button', { name: 'Deselect first' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  fireEvent.click(screen.getByRole('button', { name: 'Select second' }))
  expect(screen.getByRole('dialog', { name: 'second' })).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Deselect first' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: 'Deselect second' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add 2' }))

  await waitFor(() => {
    const calls = fetchMock.mock.calls.filter(([path, init]) =>
      String(path) === '/api/batches/batch-1/shots' && init?.method === 'POST')
    expect(calls).toHaveLength(2)
    expect(calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ clip_id: 'clip-ready' }),
      JSON.stringify({ clip_id: 'clip-second' }),
    ])
  })
})

test('deletes one clip from its row or several clips from the selection bar after confirmation', async () => {
  const current = sequencedBatch()
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': current,
    'DELETE /api/projects/clip-ready': { deleted: 1 },
    'DELETE /api/projects/clip-second': { deleted: 1 },
  })

  const firstRender = renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Delete first' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Delete this video?')
  fireEvent.click(screen.getByRole('button', { name: 'Delete video' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/clip-ready',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )

  firstRender.unmount()
  fetchMock.mockClear()
  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Select first' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close video preview' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select second' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close video preview' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected videos' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete 2 videos?' })
  expect(dialog).toHaveTextContent('Delete 2 videos?')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete selected' }))

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/clip-ready',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/clip-second',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
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

test('adds an image beside text and places it across the full timeline', async () => {
  const withImage = { ...placed, media: [sequenceImage] }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': placed,
    'POST /api/storage/images': storedImage,
    'POST /api/batches/batch-1/media/from-storage': withImage,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const addText = await screen.findByRole('button', { name: 'Add text' })
  const addMedia = screen.getByRole('button', { name: 'Add media' })
  expect(addMedia.parentElement?.parentElement).toBe(addText.parentElement?.parentElement)
  fireEvent.click(addMedia)

  const dialog = screen.getByRole('dialog', { name: 'Add an image' })
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['image'], 'brand-mark.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to timeline' }))

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path, init]) =>
      String(path) === '/api/storage/images' && init?.method === 'POST')
    expect(call).toBeDefined()
    const body = call?.[1]?.body as FormData
    expect((body.get('image') as File).name).toBe('brand-mark.png')
  })
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/media/from-storage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ storage_image_id: 'stored-1', end_ms: 8000 }),
      }),
    ),
  )

  const mediaTrack = await screen.findByRole('list', { name: 'Media' })
  expect(within(mediaTrack).getByRole('button', { name: /brand-mark.png, 00:00.0 to 00:08.0/ }))
    .toBeVisible()
  expect(document.querySelector('.player__overlay--sequence img')).toHaveAttribute(
    'src',
    '/api/batches/batch-1/media/media-1/file',
  )
})

test('Shift-selects text and media and removes both with Backspace', async () => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })
  const current = { ...placed, titles: [sequenceTitle], media: [sequenceImage] }
  const withoutTitle = { ...current, titles: [] }
  const withoutLayers = { ...withoutTitle, media: [] }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': current,
    'GET /api/fonts': { families: [], faces: [] },
    'DELETE /api/batches/batch-1/titles/title-1': withoutTitle,
    'DELETE /api/batches/batch-1/media/media-1': withoutLayers,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const titleTrack = await screen.findByRole('list', { name: 'Titles' })
  const mediaTrack = screen.getByRole('list', { name: 'Media' })
  const title = within(titleTrack).getByRole('button', { name: /Follow for more/ })
  const image = within(mediaTrack).getByRole('button', { name: /brand-mark.png/ })

  fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 40 })
  fireEvent.pointerUp(title, { pointerId: 1, clientX: 40 })
  fireEvent.pointerDown(image, { pointerId: 2, button: 0, clientX: 40, shiftKey: true })
  fireEvent.pointerUp(image, { pointerId: 2, clientX: 40, shiftKey: true })

  expect(title).toHaveAttribute('aria-pressed', 'true')
  expect(image).toHaveAttribute('aria-pressed', 'true')

  fireEvent.keyDown(image, { key: 'Backspace' })

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/titles/title-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/media/media-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  expect(within(titleTrack).queryByRole('button', { name: /Follow for more/ }))
    .not.toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Media' })).not.toBeInTheDocument()
})

test('a full-length title and image hold the last frame of the sequence', async () => {
  stubApi({
    'GET /api/batches/batch-1': { ...placed, titles: [sequenceTitle], media: [sequenceImage] },
    'GET /api/fonts': { families: [], faces: [] },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const player = await screen.findByRole('region', { name: 'Player' })
  await waitFor(() =>
    expect(document.querySelector('.player__title-text')).toHaveTextContent('Follow for more'),
  )

  // Exactly where `advance` parks the playhead when the sequence runs out, and
  // where dragging the scrub bar to its right edge lands. Both layers end here,
  // and a half-open span does not contain its own end — but the video is still
  // showing a frame, so they have to still be on it.
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  fireEvent.keyDown(scrub, { key: 'End' })
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '8000'))

  expect(document.querySelector('.player__title-text')).toHaveTextContent('Follow for more')
  expect(document.querySelector('.player__overlay--sequence img')).toBeInTheDocument()
})

test('saves the text and image visible on the player as one layer profile', async () => {
  const current = { ...placed, titles: [sequenceTitle], media: [sequenceImage] }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': current,
    'GET /api/layer-profiles': [],
    'GET /api/fonts': { families: [], faces: [] },
    'POST /api/batches/batch-1/layer-profiles': layerProfile,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Save or reuse layout' }))

  const dialog = screen.getByRole('dialog', { name: 'Layer profiles' })
  expect(within(dialog).getByRole('checkbox', { name: /Follow for more/ })).toBeChecked()
  expect(within(dialog).getByRole('checkbox', { name: /brand-mark.png/ })).toBeChecked()
  fireEvent.change(within(dialog).getByLabelText('Profile name'), {
    target: { value: 'Brand close' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save profile' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/layer-profiles',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Brand close',
          title_ids: ['title-1'],
          media_ids: ['media-1'],
        }),
      }),
    ),
  )
})

test('applies a saved layer profile to the full target timeline', async () => {
  const applied = { ...placed, titles: [sequenceTitle], media: [sequenceImage] }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': placed,
    'GET /api/layer-profiles': [layerProfile],
    'GET /api/fonts': { families: [], faces: [] },
    'POST /api/batches/batch-1/layer-profiles/profile-1/apply': applied,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Save or reuse layout' }))
  const dialog = screen.getByRole('dialog', { name: 'Layer profiles' })
  expect(within(dialog).getByText('0:00 → end')).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/layer-profiles/profile-1/apply',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
  const titleTrack = await screen.findByRole('list', { name: 'Titles' })
  expect(within(titleTrack).getByRole('button', { name: /Follow for more, 00:00.0 to 00:08.0/ }))
    .toBeVisible()
  const mediaTrack = screen.getByRole('list', { name: 'Media' })
  expect(within(mediaTrack).getByRole('button', { name: /brand-mark.png, 00:00.0 to 00:08.0/ }))
    .toBeVisible()
})

test('swapping profiles replaces the old ones layers and keeps hand-made ones', async () => {
  // A Batch already wearing profile-1, plus a Title the operator typed.
  const byHand = { ...sequenceTitle, id: 'title-hand', text: 'link in bio', start_ms: 4000 }
  const wearing = {
    ...placed,
    titles: [{ ...sequenceTitle, applied_profile_id: 'profile-1' }, byHand],
    media: [{ ...sequenceImage, applied_profile_id: 'profile-1' }],
  }
  const second: LayerProfile = { ...layerProfile, id: 'profile-2', name: 'New hook' }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': wearing,
    'GET /api/layer-profiles': [layerProfile, second],
    'GET /api/fonts': { families: [], faces: [] },
    'POST /api/batches/batch-1/layer-profiles/profile-2/apply': {
      ...placed,
      titles: [{ ...sequenceTitle, text: 'NEW HOOK', applied_profile_id: 'profile-2' }, byHand],
      media: [{ ...sequenceImage, applied_profile_id: 'profile-2' }],
    },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Save or reuse layout' }))
  const dialog = screen.getByRole('dialog', { name: 'Layer profiles' })

  // The one already on says so, and offers a re-apply rather than a first one.
  expect(within(dialog).getByText('On this Batch')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: /Re-apply/ })).toBeVisible()

  // Applying the other asks first, and names what would come off.
  fireEvent.click(within(dialog).getByRole('button', { name: /^Apply/ }))
  const asked = within(dialog).getByRole('alert')
  expect(asked).toHaveTextContent('Brand close is already on this Batch.')
  // Two, not three: the Title typed by hand is untagged and stays put.
  expect(asked).toHaveTextContent('Swapping removes 2 layers')
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/batches/batch-1/layer-profiles/profile-2/apply',
    expect.anything(),
  )

  fireEvent.click(within(asked).getByRole('button', { name: 'Swap' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/layer-profiles/profile-2/apply',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'replace' }) }),
    ),
  )

  const titleTrack = await screen.findByRole('list', { name: 'Titles' })
  expect(within(titleTrack).getByRole('button', { name: /NEW HOOK/ })).toBeVisible()
  expect(within(titleTrack).getByRole('button', { name: /link in bio/ })).toBeVisible()
})

test('a profile can still be stacked on top when that is what is wanted', async () => {
  const wearing = {
    ...placed,
    titles: [{ ...sequenceTitle, applied_profile_id: 'profile-1' }],
    media: [],
  }
  const second: LayerProfile = { ...layerProfile, id: 'profile-2', name: 'New hook' }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': wearing,
    'GET /api/layer-profiles': [layerProfile, second],
    'GET /api/fonts': { families: [], faces: [] },
    'POST /api/batches/batch-1/layer-profiles/profile-2/apply': wearing,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Save or reuse layout' }))
  const dialog = screen.getByRole('dialog', { name: 'Layer profiles' })
  fireEvent.click(within(dialog).getByRole('button', { name: /^Apply/ }))
  fireEvent.click(within(within(dialog).getByRole('alert')).getByRole('button', {
    name: 'Add on top',
  }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/layer-profiles/profile-2/apply',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'add' }) }),
    ),
  )
})

test('applying onto a Batch wearing nothing asks nothing', async () => {
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': placed,
    'GET /api/layer-profiles': [layerProfile],
    'GET /api/fonts': { families: [], faces: [] },
    'POST /api/batches/batch-1/layer-profiles/profile-1/apply': placed,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Save or reuse layout' }))
  const dialog = screen.getByRole('dialog', { name: 'Layer profiles' })
  fireEvent.click(within(dialog).getByRole('button', { name: /^Apply/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/layer-profiles/profile-1/apply',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'add' }) }),
    ),
  )
})

test('reuses and deletes images from global Storage', async () => {
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': placed,
    'GET /api/storage/images': [storedImage],
    'POST /api/batches/batch-1/media/from-storage': { ...placed, media: [sequenceImage] },
    'DELETE /api/storage/images/stored-1': { deleted: 1 },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  fireEvent.click(await screen.findByRole('button', { name: 'Add media' }))
  fireEvent.click(screen.getByRole('tab', { name: /Storage/ }))

  expect(await screen.findByRole('button', { name: 'Use brand-mark.png' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Add to timeline' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/media/from-storage',
      expect.objectContaining({ method: 'POST' }),
    ),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Add media' }))
  fireEvent.click(screen.getByRole('tab', { name: /Storage/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete brand-mark.png from Storage' }))
  const confirmation = screen.getByRole('alert')
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storage/images/stored-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Use brand-mark.png' })).not.toBeInTheDocument(),
  )
})

test('stretches a sequence image from either timeline edge', async () => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })
  const updatedImage = { ...sequenceImage, end_ms: 7000 }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': { ...placed, media: [sequenceImage] },
    'PATCH /api/batches/batch-1/media/media-1': { ...placed, media: [updatedImage] },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const track = await screen.findByRole('list', { name: 'Media' })
  const endHandle = track.querySelector('.sequence__handle--end') as HTMLElement
  fireEvent.pointerDown(endHandle, { pointerId: 1, button: 0, clientX: 192 })
  fireEvent.pointerMove(endHandle, { pointerId: 1, clientX: 168 })
  fireEvent.pointerUp(endHandle, { pointerId: 1, clientX: 168 })

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/media/media-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ end_ms: 7000 }) }),
    ),
  )
})

test('moves and resizes a sequence image directly in the player', async () => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })
  const movedImage = { ...sequenceImage, center_x: 70, center_y: 60 }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': { ...placed, media: [sequenceImage] },
    'PATCH /api/batches/batch-1/media/media-1': { ...placed, media: [movedImage] },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const image = await screen.findByRole('button', { name: 'Move brand-mark.png' })
  const mediaStage = document.querySelector<HTMLElement>('.player__media')!
  vi.spyOn(mediaStage, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 420,
    width: 200,
    height: 400,
    toJSON: () => ({}),
  })

  // The image starts centred at 110 × 220. Pull it 40px right and down:
  // that is 20% of the stage width and 10% of its height.
  fireEvent.pointerDown(image, { pointerId: 1, button: 0, clientX: 110, clientY: 220 })
  fireEvent.pointerMove(image, { pointerId: 1, clientX: 150, clientY: 260 })
  fireEvent.pointerUp(image, { pointerId: 1, clientX: 150, clientY: 260 })

  await waitFor(() => {
    const calls = fetchMock.mock.calls.filter(([path, init]) =>
      String(path).endsWith('/media/media-1') && init?.method === 'PATCH')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ center_x: 70, center_y: 60 })
  })

  const resize = document.querySelector<HTMLElement>('.player__media-grip--se')!
  expect(resize).not.toBeNull()
  fireEvent.pointerDown(resize, { pointerId: 2, button: 0, clientX: 175, clientY: 310 })
  fireEvent.pointerMove(resize, { pointerId: 2, clientX: 180, clientY: 320 })
  fireEvent.pointerUp(resize, { pointerId: 2, clientX: 180, clientY: 320 })

  await waitFor(() => {
    const calls = fetchMock.mock.calls.filter(([path, init]) =>
      String(path).endsWith('/media/media-1') && init?.method === 'PATCH')
    expect(calls).toHaveLength(2)
    const resizePatch = JSON.parse(String(calls[1][1]?.body))
    expect(resizePatch.width_percent).toBeCloseTo(78)
  })
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

test('a Player border pans its own axis alone, however the drag wanders', async () => {
  const zoomed = sequencedBatch({
    shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0, frame_zoom: 2 })],
  })
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': zoomed })
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 1/)

  const cage = screen.getByLabelText('Framing controls for first')
  const stage = document.querySelector<HTMLElement>('.player__stage')!
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 533, right: 300, bottom: 533 }) as DOMRect
  const left = cage.querySelector<HTMLElement>('.player__framing-edge--left')!

  // Deliberately diagonal: the vertical travel must be ignored entirely.
  fireEvent.pointerDown(left, { pointerId: 1, clientX: 10, clientY: 260 })
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 70, clientY: 400 })
  expect(within(cage).getByText('Positioning across')).toBeVisible()
  const activeVideo = document.querySelector<HTMLElement>('.player__video.is-active')!
  expect(activeVideo.style.getPropertyValue('--frame-y')).toBe('50%')
  fireEvent.pointerUp(left, { pointerId: 1, clientX: 70, clientY: 400 })

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/batches/batch-1/shots/shot-1' && options?.method === 'PATCH',
    )
    expect(call).toBeTruthy()
    const body = JSON.parse(String(call?.[1]?.body))
    expect(body.frame_center_x).not.toBe(50)
    expect(body.frame_center_y).toBe(50)
    expect(body.frame_zoom).toBe(2)
  })
})

test('a pan that comes back near the middle snaps the picture to centred', async () => {
  // Panned off centre and 2× in, so there is picture either side to pull back.
  const panned = sequencedBatch({
    shots: [
      makeShot({
        id: 'shot-1',
        clip_id: 'clip-ready',
        position: 0,
        frame_zoom: 2,
        frame_center_x: 60,
      }),
    ],
  })
  const fetchMock = stubApi({ 'GET /api/batches/batch-1': panned })
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 1/)

  const cage = screen.getByLabelText('Framing controls for first')
  const stage = document.querySelector<HTMLElement>('.player__stage')!
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 533, right: 300, bottom: 533 }) as DOMRect
  const left = cage.querySelector<HTMLElement>('.player__framing-edge--left')!

  // On a 300px stage at 2×, a pixel of pointer travel is a third of a percent,
  // so 27px lands on 51 — three pixels of picture short of the middle.
  fireEvent.pointerDown(left, { pointerId: 1, clientX: 10, clientY: 260 })
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 37, clientY: 260 })

  const activeVideo = document.querySelector<HTMLElement>('.player__video.is-active')!
  expect(activeVideo.style.getPropertyValue('--frame-x')).toBe('50%')
  expect(cage.querySelector('.player__centre-line--x')).not.toBeNull()
  expect(within(cage).getByText('Centred · Alt to slip past')).toBeVisible()

  fireEvent.pointerUp(left, { pointerId: 1, clientX: 37, clientY: 260 })
  expect(cage.querySelector('.player__centre-line')).toBeNull()

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/batches/batch-1/shots/shot-1' && options?.method === 'PATCH',
    )
    expect(call).toBeTruthy()
    // Exactly 50, which is what the sliders and the renderer call centred.
    expect(JSON.parse(String(call?.[1]?.body)).frame_center_x).toBe(50)
  })
})

test('a sequence image dropped near the middle is taken to the exact centre', async () => {
  const offCentre = { ...sequenceImage, center_x: 30, center_y: 70 }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': { ...placed, media: [offCentre] },
    'PATCH /api/batches/batch-1/media/media-1': { ...placed, media: [sequenceImage] },
  })
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const image = await screen.findByRole('button', { name: 'Move brand-mark.png' })
  const mediaStage = document.querySelector<HTMLElement>('.player__media')!
  vi.spyOn(mediaStage, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 420,
    width: 200,
    height: 400,
    toJSON: () => ({}),
  })

  // It starts at 30% × 70%, which is (70, 300) here. Dropped two pixels left of
  // the middle and two below it — inside the magnet on both axes.
  fireEvent.pointerDown(image, { pointerId: 1, button: 0, clientX: 70, clientY: 300 })
  fireEvent.pointerMove(image, { pointerId: 1, clientX: 108, clientY: 222 })

  expect(document.querySelector('.player__centre-line--x')).not.toBeNull()
  expect(document.querySelector('.player__centre-line--y')).not.toBeNull()
  expect(screen.getByText('Centred · Alt to slip past')).toBeVisible()

  fireEvent.pointerUp(image, { pointerId: 1, clientX: 108, clientY: 222 })

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(
      ([path, init]) => String(path).endsWith('/media/media-1') && init?.method === 'PATCH',
    )
    expect(call).toBeTruthy()
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ center_x: 50, center_y: 50 })
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

test('turns unwanted automatic subtitles off from the selected shot', async () => {
  const captioned = makeClip({
    ...readyClip,
    captions: [
      {
        id: 'caption-1',
        sequence: 0,
        start_ms: 0,
        end_ms: 5000,
        text: 'you Here',
        edited: false,
      },
    ],
  })
  const current = sequencedBatch({
    clips: [captioned, secondClip],
    shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0 })],
  })
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': current,
    'PATCH /api/projects/clip-ready': { ...captioned, captions_enabled: false },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 1/)

  expect(screen.getByText('you Here')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Turn subtitles off for first' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/clip-ready',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ captions_enabled: false }),
      }),
    ),
  )
  expect(screen.queryByText('you Here')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Turn subtitles on for first' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
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
  expect(screen.getByRole('button', { name: 'Select first' })).toBeVisible()

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

test('right-clicking a timeline clip offers the shared remove menu', async () => {
  const removed = sequencedBatch({
    shots: [makeShot({ id: 'shot-2', clip_id: 'clip-second', position: 0 })],
  })
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': placed,
    'DELETE /api/batches/batch-1/shots/shot-1': removed,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const timeline = await screen.findByRole('list', { name: 'Timeline' })
  fireEvent.contextMenu(within(timeline).getByRole('button', { name: /first, shot 1 of 2/ }), {
    clientX: 80,
    clientY: 120,
  })

  const menu = screen.getByRole('menu', { name: 'Clip options for first' })
  const remove = within(menu).getByRole('menuitem', { name: /Remove clip from timeline Del/ })
  expect(remove).toBeVisible()
  fireEvent.click(remove)

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  expect(await screen.findByRole('button', { name: 'Undo' })).toBeVisible()
})

test('Delete removes the selected timeline clip but not while editing a field', async () => {
  const trimmed = sequencedBatch({
    shots: [makeShot({ id: 'shot-1', clip_id: 'clip-ready', position: 0 })],
  })
  const removed = sequencedBatch({ shots: [] })
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': trimmed,
    'DELETE /api/batches/batch-1/shots/shot-1': removed,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  await selectShot(/first, shot 1 of 1/)

  const inPoint = screen.getByRole('spinbutton', { name: 'Shot in point, seconds' })
  fireEvent.keyDown(inPoint, { key: 'Delete' })
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/batches/batch-1/shots/shot-1',
    expect.objectContaining({ method: 'DELETE' }),
  )

  const timeline = screen.getByRole('list', { name: 'Timeline' })
  const shot = within(timeline).getByRole('button', { name: /first, shot 1 of 1/ })
  fireEvent.keyDown(shot, { key: 'Delete' })

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({ method: 'DELETE' }),
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
    cancel_requested_at: null,
    download_url: null,
    stale: false,
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
        cancel_requested_at: null,
        download_url: null,
        stale: false,
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const bar = await screen.findByRole('progressbar', { name: 'Export progress' })
  expect(bar).toHaveAttribute('aria-valuenow', '45')
  expect(screen.getByRole('tooltip', { name: /Rendering clip 1 of 2/ })).toBeInTheDocument()
  // An export that has started cannot be started again, so the button spends
  // the wait offering the only thing left to do with it.
  expect(screen.getByRole('button', { name: 'Stop export' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Export video' })).not.toBeInTheDocument()
})

test('stops a running export from the button that started it', async () => {
  const exporting = {
    id: 'seq-1',
    batch_id: 'batch-1',
    status: 'running' as const,
    progress: 45,
    message: 'Rendering clip 1 of 2',
    size_bytes: null,
    duration_ms: null,
    shot_count: 2,
    error_message: null,
    created_at: '2026-08-02T12:00:00Z',
    completed_at: null,
    cancel_requested_at: null,
    download_url: null,
    stale: false,
  }
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: exporting,
    }),
    'POST /api/batches/batch-1/render/cancel': exporting,
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: 'Stop export' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/render/cancel',
      expect.objectContaining({ method: 'POST' }),
    ),
  )

  // The Batch still reports the export as running — the row does not carry the
  // request until the worker's next poll, and the reply is not what the panel
  // reads. Falling back to the exporting look in that gap would say the click
  // had been thrown away.
  expect(await screen.findByText('Stopping…')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Stop export' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: 'Stopping export' })).toBeDisabled()
})

test('waits out a stop rather than offering a second one', async () => {
  // The window the worker owns: the request is recorded, and it still has an
  // ffmpeg pass to kill before the status can honestly change.
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
        cancel_requested_at: '2026-08-02T12:01:00Z',
        download_url: null,
        stale: false,
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  expect(await screen.findByText('Stopping…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Stopping export' })).toBeDisabled()
  // A percentage that kept climbing would say it was still being made.
  expect(screen.queryByRole('progressbar', { name: 'Export progress' })).not.toBeInTheDocument()
})

test('a stopped export can be asked for again, and is not reported as failed', async () => {
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: {
        id: 'seq-1',
        batch_id: 'batch-1',
        status: 'cancelled',
        progress: 0,
        message: 'Export cancelled',
        size_bytes: null,
        duration_ms: null,
        shot_count: 2,
        error_message: null,
        created_at: '2026-08-02T12:00:00Z',
        completed_at: '2026-08-02T12:01:00Z',
        cancel_requested_at: '2026-08-02T12:01:00Z',
        download_url: null,
        stale: false,
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  expect(await screen.findByText('Export stopped')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Export video' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/render',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
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
        // The count is untouched: the edit was a retrim, a Title, an image —
        // anything but a Shot added or removed. The API is what decides, by
        // comparing the export against when the Batch was last edited.
        shot_count: 2,
        stale: true,
        error_message: null,
        created_at: '2026-08-02T12:00:00Z',
        completed_at: '2026-08-02T12:02:00Z',
        cancel_requested_at: null,
        download_url: '/api/batches/batch-1/render/download',
      },
    }),
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const link = await screen.findByRole('link', { name: /Download MP4/ })
  expect(link).toHaveAttribute('href', '/api/batches/batch-1/render/download')
  expect(screen.getByText(/timeline changed since this export/i)).toBeInTheDocument()
})

const finishedExport = {
  id: 'seq-1',
  batch_id: 'batch-1',
  status: 'complete' as const,
  progress: 100,
  message: 'Sequence ready',
  size_bytes: 4_200_000,
  duration_ms: 8000,
  shot_count: 2,
  error_message: null,
  created_at: '2026-08-02T12:00:00Z',
  completed_at: '2026-08-02T12:02:00Z',
  cancel_requested_at: null,
  download_url: '/api/batches/batch-1/render/download',
  stale: false,
}

const connectedInstagram = {
  platform: 'instagram',
  display_name: 'Instagram',
  configured: true,
  missing_configuration: [],
  account: {
    id: 'account-1',
    platform: 'instagram',
    remote_user_id: 'ig-1',
    username: 'clipfarmer',
    display_name: 'Clip Farmer',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    status: 'connected',
    token_expires_at: null,
    connected_at: '2026-08-01T12:00:00Z',
    updated_at: '2026-08-01T12:00:00Z',
  },
}

test('publishing asks where first, then what to say, and posts each destination on its own', async () => {
  const fetchMock = stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: finishedExport,
    }),
    'GET /api/platforms': [connectedInstagram],
    'POST /api/batches/batch-1/publish/instagram': {
      id: 'publication-1',
      batch_id: 'batch-1',
      sequence_render_id: 'seq-1',
      platform: 'instagram',
      status: 'queued',
      progress: 0,
      message: 'Queued for Instagram',
      caption: 'Ship it',
      options: { share_to_feed: true, thumb_offset_ms: null },
      permalink: null,
      remote_media_id: null,
      error_message: null,
      created_at: '2026-08-02T12:05:00Z',
      completed_at: null,
    },
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /^Publish/ }))

  // Destinations first: only the ones Clip Farm can actually reach are pickable.
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Posting as @clipfarmer')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: /Instagram · Reels/ })).toBeEnabled()
  expect(within(dialog).getByRole('button', { name: /TikTok/ })).toBeDisabled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Write the caption' }))

  const caption = within(dialog).getByRole('textbox')
  fireEvent.change(caption, { target: { value: 'Ship it' } })
  expect(within(dialog).getByText('0 / 30 hashtags')).toBeVisible()

  fireEvent.click(within(dialog).getByRole('button', { name: /Post to Instagram/ }))

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          String(path) === '/api/batches/batch-1/publish/instagram' &&
          init?.method === 'POST' &&
          JSON.parse(String(init?.body)).caption === 'Ship it',
      ),
    ).toBe(true),
  )
  expect(await within(dialog).findByRole('progressbar', { name: /Instagram posting/ })).toBeVisible()
})

test('opens the four-photo cover creator from Instagram publishing details', async () => {
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: finishedExport,
    }),
    'GET /api/platforms': [connectedInstagram],
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /^Publish/ }))
  const publishDialog = await screen.findByRole('dialog')
  await within(publishDialog).findByText('Posting as @clipfarmer')
  fireEvent.click(within(publishDialog).getByRole('button', { name: 'Write the caption' }))
  fireEvent.click(within(publishDialog).getByRole('button', { name: 'Create 4-photo' }))

  const creator = screen.getByRole('dialog', { name: 'Create four-photo Instagram cover' })
  expect(within(creator).getByRole('heading', { name: /Four moments/ })).toBeVisible()
  expect(within(creator).getByRole('button', { name: 'Select 4 photos' })).toBeVisible()
  fireEvent.click(within(creator).getByRole('button', { name: 'Close four-photo cover creator' }))
  expect(screen.queryByRole('dialog', { name: 'Create four-photo Instagram cover' })).toBeNull()
})

test('an export made before the last edit is called out before it is posted', async () => {
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      // Same Shot count as the timeline: only the API's comparison against the
      // Batch's last edit can catch this, which is the point.
      sequence_render: { ...finishedExport, stale: true },
    }),
    'GET /api/platforms': [connectedInstagram],
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /^Publish/ }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('Posting as @clipfarmer')
  expect(within(dialog).getByText('Edited since this export')).toBeVisible()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Write the caption' }))
  expect(within(dialog).getByText(/posts the older cut/i)).toBeVisible()
  // Still allowed — posting the previous cut is a choice, not a mistake to block.
  expect(within(dialog).getByRole('button', { name: /Post the older cut/ })).toBeEnabled()
})

test('checking for changes pulls the batch again without closing the dialog', async () => {
  // Flipped once the dialog is already open and settled: nothing polls while
  // idle, so only asking can find this out.
  let edited = false
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/batches/batch-1' && (init?.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        json: async () =>
          sequencedBatch({
            shots: placed.shots,
            sequence_render: { ...finishedExport, stale: edited },
          }),
      }
    }
    if (path === '/api/batches') return { ok: true, json: async () => [summary] }
    if (path === '/api/platforms') return { ok: true, json: async () => [connectedInstagram] }
    return { ok: true, json: async () => [] }
  })
  vi.stubGlobal('fetch', fetchMock)

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /^Publish/ }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('Posting as @clipfarmer')
  expect(within(dialog).queryByText('Edited since this export')).toBeNull()

  edited = true
  fireEvent.click(within(dialog).getByRole('button', { name: /Check for changes/ }))

  expect(await within(dialog).findByText('Edited since this export')).toBeVisible()
  // Still open, and still on the step it was on.
  expect(within(dialog).getByRole('button', { name: 'Write the caption' })).toBeVisible()
})

test('reopening the dialog pulls the batch again, same as asking it to check', async () => {
  // Flipped by hand between the two openings, standing in for an edit made
  // while the dialog was shut.
  let edited = false
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/batches/batch-1' && (init?.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        json: async () =>
          sequencedBatch({
            shots: placed.shots,
            sequence_render: { ...finishedExport, stale: edited },
          }),
      }
    }
    if (path === '/api/batches') return { ok: true, json: async () => [summary] }
    if (path === '/api/platforms') return { ok: true, json: async () => [connectedInstagram] }
    return { ok: true, json: async () => [] }
  })
  vi.stubGlobal('fetch', fetchMock)

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  const publish = await screen.findByRole('button', { name: /^Publish/ })
  fireEvent.click(publish)
  const first = await screen.findByRole('dialog')
  await within(first).findByText('Posting as @clipfarmer')
  expect(within(first).queryByText('Edited since this export')).toBeNull()

  fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  edited = true

  fireEvent.click(screen.getByRole('button', { name: /^Publish/ }))
  const second = await screen.findByRole('dialog')
  expect(await within(second).findByText('Edited since this export')).toBeVisible()
})

test('a caption over Instagram limits cannot be posted', async () => {
  stubApi({
    'GET /api/batches/batch-1': sequencedBatch({
      shots: placed.shots,
      sequence_render: finishedExport,
    }),
    'GET /api/platforms': [connectedInstagram],
  })

  renderApp(newClient(), '/modes/batch-process/batches/batch-1')

  fireEvent.click(await screen.findByRole('button', { name: /^Publish/ }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('Posting as @clipfarmer')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Write the caption' }))
  fireEvent.change(within(dialog).getByRole('textbox'), {
    target: { value: Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(' ') },
  })

  expect(within(dialog).getByText('31 / 30 hashtags')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: /Post to Instagram/ })).toBeDisabled()
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
        cancel_requested_at: null,
        download_url: null,
        stale: false,
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
