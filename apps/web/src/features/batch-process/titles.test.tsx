import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from '../../App'
import { resolveFace, rgba, titleCss, titleIsVisible } from '../../lib/titles'
import type {
  Batch,
  BatchSummary,
  FontCatalog,
  Project,
  Shot,
  Title,
  TitleStyle,
} from '../../types'
import { applyTitleEdit } from './BatchProcessPage'
import { centreAt } from './TitleStage'
import { hasTitleSlot, slideTo, titleSlots } from './TitleTrack'

// --- The arithmetic the stage and the renderer share --------------------

const look = (overrides: Partial<Title> = {}): Title => ({
  id: 'title-1',
  batch_id: 'batch-1',
  text: 'WAIT FOR IT',
  start_ms: 0,
  end_ms: 3000,
  style_id: null,
  applied_profile_id: null,
  font_family: 'anton',
  font_weight: 400,
  italic: false,
  uppercase: false,
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
  center_y: 30,
  width_percent: 80,
  rotation_deg: 0,
  ...overrides,
})

const catalog: FontCatalog = {
  families: [
    { id: 'anton', name: 'Anton', category: 'display', weights: [400] },
    { id: 'inter', name: 'Inter', category: 'sans', weights: [400, 700, 900] },
  ],
  faces: [
    { id: 'anton-400', family: 'anton', weight: 400, weight_label: 'Regular', file: 'Anton-Regular.ttf', ass_size_scale: 1.7334, url: '/api/fonts/Anton-Regular.ttf' },
    { id: 'inter-400', family: 'inter', weight: 400, weight_label: 'Regular', file: 'Inter-Regular.ttf', ass_size_scale: 1.43018, url: '/api/fonts/Inter-Regular.ttf' },
    { id: 'inter-700', family: 'inter', weight: 700, weight_label: 'Bold', file: 'Inter-Bold.ttf', ass_size_scale: 1.43018, url: '/api/fonts/Inter-Bold.ttf' },
    { id: 'inter-900', family: 'inter', weight: 900, weight_label: 'Black', file: 'Inter-Black.ttf', ass_size_scale: 1.43018, url: '/api/fonts/Inter-Black.ttf' },
  ],
}

test('a title is sized against the stage, not the viewport', () => {
  // Container units are what keep the stage and the export agreeing without
  // either measuring the other (ADR 0008).
  const { box } = titleCss(look({ font_size_percent: 7.5, width_percent: 60 }), null)

  expect(box.fontSize).toBe('7.5cqh')
  expect(box.width).toBe('60cqw')
})

test('a title uses the same font line box as its export', () => {
  const face = resolveFace(catalog, 'anton', 400)
  const { box } = titleCss(look(), face)

  expect(box.lineHeight).toBe(1.7334)
})

test('a title is centred on its place in the frame', () => {
  const { box } = titleCss(look({ center_x: 25, center_y: 80, rotation_deg: 12 }), null)

  expect(box.left).toBe('25%')
  expect(box.top).toBe('80%')
  expect(box.transform).toBe('translate(-50%, -50%) rotate(12deg)')
})

test('the outline is doubled and painted behind the fill', () => {
  // ASS draws its outline outward; a CSS stroke straddles the glyph's path, so
  // only half of a doubled stroke shows and the two agree.
  const { text } = titleCss(look({ outline_width: 0.1 }), null)

  expect(text.WebkitTextStrokeWidth).toBe('0.2em')
  expect(text.paintOrder).toBe('stroke fill')
})

test('a panel replaces the outline rather than joining it', () => {
  const { text } = titleCss(
    look({ background: 'box', background_color: '#FFE500', background_opacity: 1, outline_width: 0.1 }),
    null,
  )

  expect(text.background).toBe('rgba(255, 229, 0, 1)')
  // The same exclusive choice libass's BorderStyle makes.
  expect(text.WebkitTextStrokeWidth).toBeUndefined()
  // Cloned so the panel hugs each line, as an opaque box does.
  expect(text.boxDecorationBreak).toBe('clone')
})

test('opacity colours the text rather than fading the panel with it', () => {
  const { text } = titleCss(
    look({ opacity: 0.5, background: 'box', background_opacity: 1 }),
    null,
  )

  expect(text.color).toBe('rgba(255, 255, 255, 0.5)')
  expect(text.background).toBe('rgba(0, 0, 0, 1)')
})

test('rgba reads a hex colour at an opacity', () => {
  expect(rgba('#FFE500', 0.4)).toBe('rgba(255, 229, 0, 0.4)')
})

test('a weight a family lacks resolves to its nearest', () => {
  // Anton is a single face, and asking for Black must still draw.
  expect(resolveFace(catalog, 'anton', 900)?.id).toBe('anton-400')
  expect(resolveFace(catalog, 'inter', 900)?.id).toBe('inter-900')
  expect(resolveFace(catalog, 'inter', 700)?.id).toBe('inter-700')
})

test('an unknown family still draws something', () => {
  expect(resolveFace(catalog, 'gone', 400)?.family).toBe('inter')
})

test('a title is on screen only inside its own span', () => {
  const title = look({ start_ms: 1000, end_ms: 2000 })

  expect(titleIsVisible(title, 999)).toBe(false)
  expect(titleIsVisible(title, 1000)).toBe(true)
  // The end is exclusive, so a title never outlives its last millisecond.
  expect(titleIsVisible(title, 2000)).toBe(false)
})

test('dragging a title never pushes it off either end of the sequence', () => {
  expect(slideTo(-500)).toBe(0)
  // Snapped to a tenth of a second, as a Shot's trim is.
  expect(slideTo(1234)).toBe(1200)

  // A four-second title on a ten-second sequence stops with its tail on the
  // end, because the tail past it would render as nothing.
  expect(slideTo(9000, 10_000 - 4_000)).toBe(6_000)
  // A title longer than the sequence has nowhere to stop but the front.
  expect(slideTo(3000, 10_000 - 12_000)).toBe(0)
})

test('overlapping titles fill three rows and later text reuses the first open row', () => {
  const titles = [
    look({ id: 'one', start_ms: 0, end_ms: 3000 }),
    look({ id: 'two', start_ms: 1000, end_ms: 4000 }),
    look({ id: 'three', start_ms: 2000, end_ms: 5000 }),
    look({ id: 'later', start_ms: 5000, end_ms: 6000 }),
  ]

  expect([...titleSlots(titles)]).toEqual([
    ['one', 0],
    ['two', 1],
    ['three', 2],
    ['later', 0],
  ])
})

test('only three title slots can cover the same instant', () => {
  const titles = ['one', 'two', 'three'].map((id) =>
    look({ id, start_ms: 0, end_ms: 3000 }),
  )

  expect(hasTitleSlot(titles, 1000, 2000)).toBe(false)
  expect(hasTitleSlot(titles, 3000, 4000)).toBe(true)
})

test('dragging on the stage keeps a title inside the frame', () => {
  const stage = { left: 100, top: 50, width: 200, height: 400 }

  expect(centreAt({ x: 200, y: 250 }, { x: 0, y: 0 }, stage)).toEqual({
    center_x: 50,
    center_y: 50,
  })
  // Dragged past the edge, it stops at it rather than leaving the picture.
  expect(centreAt({ x: 9999, y: -9999 }, { x: 0, y: 0 }, stage)).toEqual({
    center_x: 100,
    center_y: 0,
  })
})

test('the grab offset stops a title jumping under the cursor', () => {
  const stage = { left: 0, top: 0, width: 200, height: 400 }
  // Picked up 20px right of its centre, it stays 20px right of the pointer.
  expect(centreAt({ x: 120, y: 200 }, { x: 20, y: 0 }, stage).center_x).toBe(50)
})

test('a title edit lands in the cache before the round trip finishes', () => {
  const batch = { titles: [look({ id: 'a' }), look({ id: 'b' })] } as Batch

  const moved = applyTitleEdit(batch, {
    kind: 'patch',
    titleId: 'b',
    patch: { start_ms: 4000, end_ms: 7000 },
  })

  expect(moved.titles.map((title) => [title.id, title.start_ms])).toEqual([
    ['a', 0],
    ['b', 4000],
  ])
  expect(applyTitleEdit(batch, { kind: 'remove', titleId: 'a' }).titles).toHaveLength(1)
  // Only the server can name a new Title, so an add is not predicted.
  expect(applyTitleEdit(batch, { kind: 'add' }).titles).toHaveLength(2)
})

// --- The Title Track and the stage, in the page -------------------------

const clip: Project = {
  id: 'clip-a',
  mode: 'batch-process',
  origin_kind: 'upload',
  batch_id: 'batch-1',
  source_url: null,
  source_post_id: null,
  source_caption: null,
  social_caption: null,
  title: 'first',
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
  updated_at: '2026-08-02T12:00:00Z',
  artifacts: [{ id: 'art-1', kind: 'preview', mime_type: 'video/mp4', size_bytes: 1, url: '/api/artifacts/art-1' }],
  captions: [],
  image_overlays: [],
  renders: [],
  latest_job: null,
}

const shot: Shot = {
  id: 'shot-1',
  clip_id: 'clip-a',
  position: 0,
  trim_start_ms: null,
  trim_end_ms: null,
  frame_zoom: 1,
  frame_center_x: 50,
  frame_center_y: 50,
}

const styles: TitleStyle[] = [
  { ...look(), id: 'builtin:hook', name: 'Hook', builtin: true } as unknown as TitleStyle,
  {
    ...look({ font_family: 'inter', font_weight: 700, background: 'box', center_y: 78 }),
    id: 'builtin:caption-bar',
    name: 'Caption bar',
    builtin: true,
  } as unknown as TitleStyle,
]

const summary: BatchSummary = {
  id: 'batch-1',
  name: 'Tuesday pulls',
  format: 'vertical',
  created_at: '2026-08-02T12:00:00Z',
  updated_at: '2026-08-02T12:00:00Z',
  clip_count: 1,
  importing_count: 0,
  failed_count: 0,
  shot_count: 1,
}

function makeBatch(titles: Title[]): Batch {
  return {
    id: 'batch-1',
    name: 'Tuesday pulls',
    format: 'vertical',
    created_at: '2026-08-02T12:00:00Z',
    updated_at: '2026-08-02T12:00:00Z',
    clips: [clip],
    shots: [shot],
    cutaways: [],
    titles,
    media: [],
    sequence_render: null,
    sequence_publications: [],
  }
}

function stubApi(batch: Batch, overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const key = `${init?.method ?? 'GET'} ${path}`
    if (key in overrides) return { ok: true, json: async () => overrides[key] }
    if (path === '/api/batches') return { ok: true, json: async () => [summary] }
    if (path === '/api/batches/batch-1') return { ok: true, json: async () => batch }
    if (path === '/api/title-styles') return { ok: true, json: async () => styles }
    if (path === '/api/fonts') return { ok: true, json: async () => catalog }
    return { ok: true, json: async () => [] }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderBatch(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/modes/batch-process/batches/batch-1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('the timeline gives titles a track of their own', async () => {
  stubApi(makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })]))

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  // Its own lane, beside the Shots rather than inside one.
  expect(within(track).getByRole('button', { name: /WAIT FOR IT/ })).toBeVisible()
  expect(screen.getByRole('list', { name: 'Timeline' })).toBeVisible()
  expect(screen.queryByRole('list', { name: 'Cutaways' })).toBeNull()
})

test('a batch carries three visible title slots at a time', async () => {
  stubApi(
    makeBatch([
      look({ id: 'title-1', text: 'FIRST', start_ms: 0, end_ms: 2000 }),
      look({ id: 'title-2', text: 'SECOND', start_ms: 1000, end_ms: 4000 }),
      look({ id: 'title-3', text: 'THIRD', start_ms: 1500, end_ms: 3500 }),
    ]),
  )

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  const first = within(track).getByRole('button', { name: /FIRST/ }).closest('li')
  const second = within(track).getByRole('button', { name: /SECOND/ }).closest('li')
  const third = within(track).getByRole('button', { name: /THIRD/ }).closest('li')
  expect(first).toHaveStyle({ top: '0px' })
  expect(second).toHaveStyle({ top: '50px' })
  expect(third).toHaveStyle({ top: '100px' })
})

test('right-clicking text can stretch it across 100% of the timeline', async () => {
  const batch = makeBatch([
    look({ id: 'title-1', text: 'SHORT TEXT', start_ms: 1000, end_ms: 2000 }),
  ])
  const fetchMock = stubApi(batch, {
    'PATCH /api/batches/batch-1/titles/title-1': batch,
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.contextMenu(within(track).getByRole('button', { name: /SHORT TEXT/ }), {
    clientX: 120,
    clientY: 160,
  })
  const menu = screen.getByRole('menu', { name: /Text options for SHORT TEXT/ })
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Fill entire timeline 100%/ }))

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) =>
      String(path).endsWith('/titles/title-1'),
    )
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      start_ms: 0,
      end_ms: 5000,
    })
  })
})

test('right-clicking text offers removal from the timeline', async () => {
  const batch = makeBatch([
    look({ id: 'title-1', text: 'DELETE ME', start_ms: 1000, end_ms: 2000 }),
  ])
  const fetchMock = stubApi(batch, {
    'DELETE /api/batches/batch-1/titles/title-1': makeBatch([]),
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.contextMenu(within(track).getByRole('button', { name: /DELETE ME/ }), {
    clientX: 120,
    clientY: 160,
  })
  const menu = screen.getByRole('menu', { name: /Text options for DELETE ME/ })
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Remove text Del/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/titles/title-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
  expect(within(track).queryByRole('button', { name: /DELETE ME/ })).not.toBeInTheDocument()
})

test('Delete removes selected text but is ignored while editing its words', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: 'DELETE ME' })])
  const fetchMock = stubApi(batch, {
    'DELETE /api/batches/batch-1/titles/title-1': makeBatch([]),
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  const title = within(track).getByRole('button', { name: /DELETE ME/ })
  fireEvent.focus(title)
  const words = await screen.findByLabelText('Title text')
  fireEvent.keyDown(words, { key: 'Delete' })
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/batches/batch-1/titles/title-1',
    expect.objectContaining({ method: 'DELETE' }),
  )

  fireEvent.keyDown(title, { key: 'Delete' })
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/titles/title-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

test('adding text is unavailable when a full-video layer would exceed three slots', async () => {
  stubApi(
    makeBatch(
      ['FIRST', 'SECOND', 'THIRD'].map((text, index) =>
        look({ id: `title-${index}`, text, start_ms: 0, end_ms: 4000 }),
      ),
    ),
  )

  renderBatch(newClient())

  const add = await screen.findByRole('button', { name: /Add text/ })
  expect(add).toBeDisabled()
  expect(add).toHaveAttribute('title', 'All three text layers are already occupied')
})

test('adding text spans the full video and opens it for editing', async () => {
  const added = look({ id: 'title-new', text: 'Your text here' })
  const fetchMock = stubApi(makeBatch([]), {
    'POST /api/batches/batch-1/titles': makeBatch([added]),
  })

  renderBatch(newClient())

  const titleTrack = await screen.findByRole('list', { name: 'Titles' })
  expect(within(titleTrack).queryByRole('button', { name: /Add text/ })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: /Add text/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/titles',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
  const sent = JSON.parse(
    (fetchMock.mock.calls.find(([path]) => String(path).endsWith('/titles'))?.[1] as RequestInit)
      .body as string,
  )
  expect(sent.start_ms).toBe(0)
  expect(sent.end_ms).toBe(5000)
  // Made from a Style, so it arrives looking like something.
  expect(sent.style_id).toBe('builtin:hook')

  // The new Title is selected, so its inspector is what the operator types into.
  expect(await screen.findByLabelText('Title text')).toHaveValue('Your text here')
})

test('selecting a title opens its inspector', async () => {
  stubApi(makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })]))

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))

  expect(await screen.findByLabelText('Title text')).toHaveValue('WAIT FOR IT')
  // The look is chosen from ready-made ones rather than assembled, so the
  // swatches are what the panel opens on.
  const looks = screen.getByRole('group', { name: 'Look' })
  expect(within(looks).getByRole('button', { name: 'Hook' })).toBeVisible()
  expect(within(looks).getByRole('button', { name: 'Caption bar' })).toBeVisible()
  // Size and place are the adjustments a look leaves open, and are not behind
  // anything.
  expect(screen.getByRole('group', { name: 'Place' })).toBeVisible()
  expect(screen.getByLabelText(/Size/)).toBeVisible()
})

test('the swatch lit is the one the title still looks like', async () => {
  // A built-in leaves no id behind on the Title — the server keeps `style_id`
  // for saved profiles only — so the match is made on the look itself.
  stubApi(makeBatch([look({ id: 'title-1', style_id: null })]))

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))

  const looks = await screen.findByRole('group', { name: 'Look' })
  expect(within(looks).getByRole('button', { name: 'Hook' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(within(looks).getByRole('button', { name: 'Caption bar' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('picking a look sends the whole of it, not only its name', async () => {
  const batch = makeBatch([look({ id: 'title-1' })])
  const fetchMock = stubApi(batch, { 'PATCH /api/batches/batch-1/titles/title-1': batch })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  const looks = await screen.findByRole('group', { name: 'Look' })

  fireEvent.click(within(looks).getByRole('button', { name: 'Caption bar' }))

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/titles/title-1'))
    const sent = JSON.parse((call?.[1] as RequestInit).body as string)
    // The values travel with the id so the stage changes on the click rather
    // than on the reply. The server would reach the same look from the id.
    expect(sent.style_id).toBe('builtin:caption-bar')
    expect(sent.font_family).toBe('inter')
    expect(sent.background).toBe('box')
    // The words and the timing are the Title's, and a look does not carry them.
    expect(sent).not.toHaveProperty('text')
    expect(sent).not.toHaveProperty('start_ms')
  })
})

test('the rest of the controls are there, behind fine-tune', async () => {
  stubApi(makeBatch([look({ id: 'title-1', font_family: 'inter', font_weight: 900 })]))

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  await screen.findByLabelText('Title text')

  // Shut, so the panel is a look and four adjustments until it is asked for.
  const weights = screen.getByRole('group', { name: 'Weight' })
  expect(within(weights).getByRole('button', { name: 'Bold' })).not.toBeVisible()

  fireEvent.click(screen.getByText(/Fine-tune/))

  // Only the weights this family was vendored at, so the picker offers no
  // near misses.
  expect(within(weights).getByRole('button', { name: 'Black' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(within(weights).getByRole('button', { name: 'Bold' })).toBeVisible()
  // Every family in the catalog is offered, grouped by the kind of face it is.
  const font = screen.getByLabelText(/Font/) as HTMLSelectElement
  expect(within(font).getByRole('option', { name: 'Anton' })).toBeInTheDocument()
  expect(within(font).getByRole('option', { name: 'Inter' })).toBeInTheDocument()
})

test('changing the font sends only what changed', async () => {
  const batch = makeBatch([look({ id: 'title-1' })])
  const fetchMock = stubApi(batch, {
    'PATCH /api/batches/batch-1/titles/title-1': batch,
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  await screen.findByLabelText('Title text')
  fireEvent.click(screen.getByText(/Fine-tune/))

  fireEvent.change(screen.getByLabelText(/Font/), { target: { value: 'inter' } })

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) =>
      String(path).endsWith('/titles/title-1'),
    )
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      font_family: 'inter',
    })
  })
})

test('saving a look as a profile names it and keeps it for the next batch', async () => {
  const batch = makeBatch([look({ id: 'title-1', font_family: 'anton', color: '#FFE500' })])
  const fetchMock = stubApi(batch, {
    'POST /api/title-styles': { ...styles[0], id: 'style-new', name: 'My hook', builtin: false },
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  await screen.findByLabelText('Title text')

  fireEvent.click(screen.getByText(/Fine-tune/))
  fireEvent.click(screen.getByRole('button', { name: /Save as profile/ }))
  fireEvent.change(screen.getByLabelText(/Profile name/), { target: { value: 'My hook' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  // The list is fetched on load too, so the write is found by its method.
  const posted = () =>
    fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === '/api/title-styles' && (init as RequestInit)?.method === 'POST',
    )
  await waitFor(() => expect(posted()).toBeDefined())
  const saved = JSON.parse((posted()?.[1] as RequestInit).body as string)
  expect(saved.name).toBe('My hook')
  expect(saved.color).toBe('#FFE500')
  // The words and the timing are the Title's, not the profile's.
  expect(saved).not.toHaveProperty('text')
  expect(saved).not.toHaveProperty('start_ms')
})

test('saving the words keeps them along with the size and the place', async () => {
  const batch = makeBatch([
    look({ id: 'title-1', text: 'Lima Peru', font_size_percent: 7.5, center_y: 26 }),
  ])
  const fetchMock = stubApi(batch, {
    'POST /api/phrases': { ...look(), id: 'phrase-new', text: 'Lima Peru' },
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /Lima Peru/ }))
  await screen.findByLabelText('Title text')

  // Under the box the words were typed in, not behind Fine-tune: this is about
  // the words, and it is the reason the panel is opened a second time.
  fireEvent.click(screen.getByRole('button', { name: /Save these words/ }))

  const posted = () =>
    fetchMock.mock.calls.find(
      ([path, init]) =>
        String(path) === '/api/phrases' && (init as RequestInit)?.method === 'POST',
    )
  await waitFor(() => expect(posted()).toBeDefined())
  const saved = JSON.parse((posted()?.[1] as RequestInit).body as string)
  expect(saved.text).toBe('Lima Peru')
  expect(saved.font_size_percent).toBe(7.5)
  expect(saved.center_y).toBe(26)
  // The timing is the Sequence's business, not the words'.
  expect(saved).not.toHaveProperty('start_ms')
  expect(saved).not.toHaveProperty('end_ms')
})

test('writing a saved phrase brings its words and its look, and leaves the timing', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: '', start_ms: 4000, end_ms: 7000 })])
  const fetchMock = stubApi(batch, {
    'GET /api/phrases': [
      { ...look({ font_family: 'inter', font_size_percent: 7.5, center_y: 26 }), id: 'phrase-1', text: 'Lima Peru' },
    ],
    'PATCH /api/batches/batch-1/titles/title-1': batch,
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /title/i }))
  const shelf = await screen.findByRole('group', { name: 'Saved words' })

  expect(screen.getByText('Saved for every batch')).toBeVisible()
  // Exactly the words: the button beside it is named for deleting this saved copy.
  fireEvent.click(within(shelf).getByRole('button', { name: 'Lima Peru' }))

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/titles/title-1'))
    const sent = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(sent.text).toBe('Lima Peru')
    expect(sent.font_size_percent).toBe(7.5)
    expect(sent.center_y).toBe(26)
    // The block was dragged to 4s on purpose; a Phrase knows nothing about that.
    expect(sent).not.toHaveProperty('start_ms')
    expect(sent).not.toHaveProperty('end_ms')
  })
  // And in the box straight away, not on the reply.
  expect(screen.getByLabelText('Title text')).toHaveValue('Lima Peru')
})

test('saved words have an always-available delete action in the UI', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: 'Lima Peru' })])
  const phrase = { ...look(), id: 'phrase-1', text: 'Lima Peru' }
  const fetchMock = stubApi(batch, {
    'GET /api/phrases': [phrase],
    'DELETE /api/phrases/phrase-1': { deleted: 1 },
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /Lima Peru/ }))
  const remove = await screen.findByRole('button', {
    name: 'Delete saved words “Lima Peru”',
  })

  expect(remove).toBeVisible()
  fireEvent.click(remove)
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/phrases/phrase-1',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

test('the shelf stays out of the way until something is on it', async () => {
  stubApi(makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })]))

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  await screen.findByLabelText('Title text')

  // Saving is always offered; the shelf appears only once it holds something.
  expect(screen.getByRole('button', { name: /Save these words/ })).toBeVisible()
  expect(screen.queryByRole('group', { name: 'Saved words' })).not.toBeInTheDocument()
})

test('the stage draws a title only while it is playing', async () => {
  stubApi(makeBatch([look({ id: 'title-1', text: 'ONLY LATER', start_ms: 2000, end_ms: 4000 })]))

  renderBatch(newClient())

  await screen.findByRole('list', { name: 'Titles' })
  const stage = screen.getByLabelText('Player')
  // The playhead starts at zero, before this Title's span.
  expect(within(stage).queryByText('ONLY LATER')).not.toBeInTheDocument()
})

test('the stage draws a title that is playing', async () => {
  stubApi(makeBatch([look({ id: 'title-1', text: 'FROM THE TOP', start_ms: 0, end_ms: 4000 })]))

  renderBatch(newClient())

  await screen.findByRole('list', { name: 'Titles' })
  const stage = screen.getByLabelText('Player')
  expect(within(stage).getByText('FROM THE TOP')).toBeVisible()
})

test('opening a title that is not on screen moves the playhead onto it', async () => {
  // The stage draws only what the export would burn in at this instant
  // (ADR 0007), so the way to make typing visible is to go to the Title rather
  // than to draw it out of its span.
  stubApi(makeBatch([look({ id: 'title-1', text: 'ONLY LATER', start_ms: 2000, end_ms: 4000 })]))

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  const stage = screen.getByLabelText('Player')
  expect(within(stage).queryByText('ONLY LATER')).not.toBeInTheDocument()

  fireEvent.focus(within(track).getByRole('button', { name: /ONLY LATER/ }))

  expect(await within(stage).findByText('ONLY LATER')).toBeVisible()
})

test('typing lands on the picture before it lands on the server', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })])
  const fetchMock = stubApi(batch, { 'PATCH /api/batches/batch-1/titles/title-1': batch })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  await screen.findByLabelText('Title text')

  fireEvent.change(screen.getByLabelText('Title text'), { target: { value: 'WAIT FOR THIS' } })

  // On the stage on the keystroke: the preview is local, so there is nothing
  // to wait for.
  const stage = screen.getByLabelText('Player')
  expect(within(stage).getByText('WAIT FOR THIS')).toBeVisible()
  // And sent once the typing stops, without needing the box to be left first.
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/titles/title-1'))
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      text: 'WAIT FOR THIS',
    })
  })
})

test('export waits for the visible title size to finish saving', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })])
  let finishSave!: (saved: Batch) => void
  const saving = new Promise<Batch>((resolve) => {
    finishSave = resolve
  })
  const fetchMock = stubApi(batch, {
    'PATCH /api/batches/batch-1/titles/title-1': saving,
    'POST /api/batches/batch-1/render': {},
  })

  renderBatch(newClient())

  const track = await screen.findByRole('list', { name: 'Titles' })
  fireEvent.focus(within(track).getByRole('button', { name: /WAIT FOR IT/ }))
  const size = await screen.findByRole('slider', { name: /Size/ })

  // Releasing the slider starts a save. Clicking Export immediately after it
  // must not let the render worker read the old 6% preset from the database.
  fireEvent.change(size, { target: { value: '9.5' } })
  fireEvent.blur(size)
  fireEvent.click(screen.getByRole('button', { name: /Export video/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/titles/title-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ font_size_percent: 9.5 }),
      }),
    ),
  )
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/batches/batch-1/render',
    expect.anything(),
  )

  finishSave({
    ...batch,
    titles: [{ ...batch.titles[0], font_size_percent: 9.5 }],
  })

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/render',
      expect.objectContaining({ method: 'POST' }),
    ),
  )
})

test('a title dropped near the middle is taken to the exact centre', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })])
  const fetchMock = stubApi(batch, { 'PATCH /api/batches/batch-1/titles/title-1': batch })
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })

  renderBatch(newClient())
  await screen.findByRole('list', { name: 'Titles' })

  const layer = document.querySelector<HTMLElement>('.player__titles')!
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400 }) as DOMRect
  const title = document.querySelector<HTMLElement>('.player__title')!

  // It starts at 50% × 30%, which is (100, 120) on this stage. Dropped 3px
  // right of the middle and 5px below it — inside the magnet's reach on both
  // axes, though 5px down is only 1.25% of a 400px stage and 3px across is
  // 1.5% of a 200px one.
  fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 100, clientY: 120 })
  fireEvent.pointerMove(title, { pointerId: 1, clientX: 103, clientY: 205 })

  // Both lines, because both axes came to rest on a centre.
  expect(document.querySelector('.player__centre-line--x')).not.toBeNull()
  expect(document.querySelector('.player__centre-line--y')).not.toBeNull()

  fireEvent.pointerUp(title, { pointerId: 1, clientX: 103, clientY: 205 })
  // The lines belong to the gesture, not to the placement.
  expect(document.querySelector('.player__centre-line')).toBeNull()

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/titles/title-1'))
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      center_x: 50,
      center_y: 50,
    })
  })
})

test('holding Alt drops a title where the pointer actually is', async () => {
  const batch = makeBatch([look({ id: 'title-1', text: 'WAIT FOR IT' })])
  const fetchMock = stubApi(batch, { 'PATCH /api/batches/batch-1/titles/title-1': batch })
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })

  renderBatch(newClient())
  await screen.findByRole('list', { name: 'Titles' })

  const layer = document.querySelector<HTMLElement>('.player__titles')!
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400 }) as DOMRect
  const title = document.querySelector<HTMLElement>('.player__title')!

  fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 100, clientY: 120 })
  fireEvent.pointerMove(title, { pointerId: 1, clientX: 103, clientY: 205, altKey: true })

  expect(document.querySelector('.player__centre-line')).toBeNull()
  fireEvent.pointerUp(title, { pointerId: 1, clientX: 103, clientY: 205, altKey: true })

  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/titles/title-1'))
    const patch = JSON.parse((call?.[1] as RequestInit).body as string)
    expect(Object.keys(patch).sort()).toEqual(['center_x', 'center_y'])
    expect(patch.center_x).toBeCloseTo(51.5, 6)
    expect(patch.center_y).toBeCloseTo(51.25, 6)
  })
})
