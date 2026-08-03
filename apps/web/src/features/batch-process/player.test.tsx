import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from '../../App'
import type { Batch, Cutaway, Project, Shot } from '../../types'

/**
 * What the Player does while it is playing.
 *
 * These exist because jsdom implements no media element, so until `setup.ts`
 * stubbed one nothing here could be asserted at all — and the one regression
 * that reached a browser (a Shot never ending, because the preview Artifact is
 * a frame shorter than the Clip's Trim) lived in exactly this code.
 *
 * The stub does not run a clock. A test moves `currentTime` itself and fires
 * `timeupdate`, which is what the real element does on its own.
 */

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

function renderApp(client: QueryClient, path: string) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
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
    // A preview to play. Without one the Player shows a placeholder instead.
    artifacts: [
      {
        id: `art-${overrides.id}`,
        kind: 'preview',
        mime_type: 'video/mp4',
        size_bytes: 1000,
        url: `/media/${overrides.id}/preview.mp4`,
      },
    ],
    captions: [],
    image_overlays: [],
    renders: [],
    latest_job: null,
    ...overrides,
  }
}

const first = makeClip({ id: 'clip-a', title: 'first' })
const second = makeClip({ id: 'clip-b', title: 'second', duration_ms: 3000, trim_end_ms: 3000 })

const makeShot = (
  overrides: Partial<Shot> & Pick<Shot, 'id' | 'clip_id' | 'position'>,
): Shot => ({
  trim_start_ms: null,
  trim_end_ms: null,
  frame_zoom: 1,
  frame_center_x: 50,
  frame_center_y: 50,
  ...overrides,
})

function makeBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'batch-1',
    name: 'Tuesday pulls',
    format: 'vertical',
    created_at: '2026-08-02T12:00:00Z',
    updated_at: '2026-08-02T12:00:00Z',
    clips: [first, second],
    shots: [
      makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 }),
      makeShot({ id: 'shot-2', clip_id: 'clip-b', position: 1 }),
    ],
    cutaways: [],
    titles: [],
    media: [],
    sequence_render: null,
    ...overrides,
  }
}

function stubApi(batch: Batch) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === '/api/batches') {
      return {
        ok: true,
        json: async () => [
          {
            id: batch.id,
            name: batch.name,
            format: batch.format,
            created_at: batch.created_at,
            updated_at: batch.updated_at,
            clip_count: batch.clips.length,
            importing_count: 0,
            failed_count: 0,
            shot_count: batch.shots.length,
          },
        ],
      } as Response
    }
    if (path === `/api/batches/${batch.id}`) {
      return { ok: true, json: async () => batch } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

/** The two swapping elements, in DOM order. The third is the Cutaway cover. */
function stageVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll<HTMLVideoElement>('.player__video')).filter(
    (video) => !video.classList.contains('player__video--cover'),
  )
}

const coverVideo = () =>
  document.querySelector<HTMLVideoElement>('.player__video--cover')!

/** Move a media element to a point and tell React, as the browser would. */
function tick(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds
  fireEvent.timeUpdate(video)
}

/**
 * How long the media claims to be.
 *
 * `duration` is read-only on a real element, and the setup stub makes it
 * writable precisely so a test can say "the preview stops here" — which is the
 * condition the Shot-boundary regression turns on.
 */
function setDuration(video: HTMLVideoElement, seconds: number) {
  ;(video as HTMLVideoElement & { duration: number }).duration = seconds
}

async function openPlayer(batch: Batch) {
  stubApi(batch)
  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  return await screen.findByRole('region', { name: 'Player' })
}

function openPlaybackOptions(player: HTMLElement) {
  fireEvent.click(within(player).getByRole('button', { name: 'More playback options' }))
}

test('Text and media start the row while Pause, Play, Export stay centered and ordered', async () => {
  const player = await openPlayer(makeBatch())
  const controls = player.querySelector<HTMLElement>('.player__primary-controls')!
  const [pause, play, exportButton] = within(controls).getAllByRole('button')
  const addText = within(player).getByRole('button', { name: 'Add text' })
  const addMedia = within(player).getByRole('button', { name: 'Add media' })

  expect(pause).toHaveAccessibleName('Pause the rough cut')
  expect(play).toHaveAccessibleName('Play the rough cut')
  expect(exportButton).toHaveAccessibleName('Export video')
  expect(addText).toHaveAccessibleName('Add text')
  expect(addMedia).toHaveAccessibleName('Add media')
  expect(controls).not.toContainElement(addText)
  expect(addText.parentElement).toHaveClass('player__layer-action')
  expect(addMedia.parentElement?.parentElement).toBe(addText.parentElement?.parentElement)
  expect(addText.parentElement?.parentElement).toHaveClass('player__layer-actions')
  const clock = within(player).getByLabelText(/Playhead and duration/)
  expect(clock.parentElement).toHaveClass('player__frame')
  expect(player.querySelector('.player__stage')).not.toContainElement(clock)
  expect(pause).toBeDisabled()
  expect(play).toBeEnabled()
  expect(within(player).queryByRole('button', { name: 'Next cut' })).toBeNull()

  fireEvent.click(play)
  expect(pause).toBeEnabled()
  expect(play).toBeDisabled()
  tick(stageVideos()[0], 2.5)
  fireEvent.click(pause)

  await waitFor(() =>
    expect(within(player).getByRole('slider', { name: 'Sequence position' })).toHaveAttribute(
      'aria-valuenow',
      '2500',
    ),
  )
  expect(clock).toHaveTextContent('00:02:15 / 00:08:00')
  expect(stageVideos()[0].paused).toBe(true)

  openPlaybackOptions(player)
  expect(within(player).getByRole('button', { name: 'Next cut' })).toBeVisible()
})

test('the idle element is primed with the next shot while the first one plays', async () => {
  await openPlayer(makeBatch())

  await waitFor(() => expect(stageVideos()).toHaveLength(2))
  const [active, idle] = stageVideos()

  // The visible element holds the first Shot's Clip; the other already holds
  // the next one, which is what makes the swap at the join instant.
  expect(active.getAttribute('src')).toContain('clip-a')
  await waitFor(() => expect(idle.getAttribute('src')).toContain('clip-b'))
})

test('playing runs the visible element and leaves the idle one paused', async () => {
  const player = await openPlayer(makeBatch())

  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active, idle] = stageVideos()
  await waitFor(() => expect(active.paused).toBe(false))
  expect(idle.paused).toBe(true)
})

test('a shot that runs out hands over to the next one', async () => {
  const player = await openPlayer(makeBatch())
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  // Two seconds into a five-second Shot: still shot 1 of 2.
  tick(active, 2)
  await waitFor(() => expect(within(player).getByText('shot 1 of 2')).toBeInTheDocument())

  // Past its Trim end. The Sequence must move on rather than stall.
  tick(active, 5)
  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeInTheDocument())
  expect(within(player).getByText('second')).toBeInTheDocument()
})

test('a preview shorter than the clip still ends the shot', async () => {
  // The regression: trim_end_ms is the Source Video's duration, but what plays
  // is the preview re-encode, which can stop short. Before this was handled the
  // Sequence stalled after one Shot.
  //
  // The Shot's Trim ends at 5.0s and the tolerance is 60ms, so the preview has
  // to stop further back than 4.94s for the Clip's own end to be no help —
  // otherwise this passes on the Trim alone and proves nothing.
  const player = await openPlayer(makeBatch())
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  setDuration(active, 4.8)
  tick(active, 4.8)

  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeInTheDocument())
})

test('a shot short of both its trim and its media keeps playing', async () => {
  // The other side of it: ending a Shot early would cut the Sequence short.
  const player = await openPlayer(makeBatch())
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  setDuration(active, 4.8)
  tick(active, 3)

  await waitFor(() => expect(within(player).getByText('shot 1 of 2')).toBeInTheDocument())
})

test('the media ending advances even when timeupdate has stopped firing', async () => {
  const player = await openPlayer(makeBatch())
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  fireEvent.ended(active)

  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeInTheDocument())
})

test('the last shot running out stops playback rather than looping', async () => {
  const single = makeBatch({ shots: [makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 })] })
  const player = await openPlayer(single)
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  fireEvent.ended(active)

  await waitFor(() =>
    expect(within(player).getByRole('button', { name: 'Play the rough cut' })).toBeVisible(),
  )
  expect(within(player).getByText('00:05:00 / 00:05:00')).toBeVisible()
})

const cutaway: Cutaway = {
  id: 'cut-1',
  clip_id: 'clip-b',
  base_shot_id: 'shot-1',
  offset_ms: 1000,
  trim_start_ms: 0,
  trim_end_ms: 2000,
  frame_zoom: 1,
  frame_center_x: 50,
  frame_center_y: 50,
}

test('a cutaway covers the picture while the shot underneath keeps the sound', async () => {
  const player = await openPlayer(
    makeBatch({
      shots: [makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 })],
      cutaways: [cutaway],
    }),
  )
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  const cover = coverVideo()
  expect(cover).not.toHaveClass('is-active')

  // One second in, where the Cutaway is anchored.
  tick(active, 1.2)

  await waitFor(() => expect(cover).toHaveClass('is-active'))
  // The cover carries the picture; the element beneath is still the sound, so
  // the cover is muted and the base element is not. This is what the export
  // does, and the one thing a Cutaway preview must not get wrong.
  expect(cover.muted).toBe(true)
  expect(active.muted).toBe(false)
  await waitFor(() => expect(cover.paused).toBe(false))
  expect(active.paused).toBe(false)
})

test('the cutaway uncovers again once its span is over', async () => {
  const player = await openPlayer(
    makeBatch({
      shots: [makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 })],
      cutaways: [cutaway],
    }),
  )
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  const cover = coverVideo()

  tick(active, 1.2)
  await waitFor(() => expect(cover).toHaveClass('is-active'))

  // Past the Cutaway's two-second span, back on the Base Shot's own picture.
  tick(active, 3.5)
  await waitFor(() => expect(cover).not.toHaveClass('is-active'))
})

test('the stage is the shape the batch renders to', async () => {
  await openPlayer(makeBatch())

  const stage = document.querySelector<HTMLElement>('.player__stage')!
  // Vertical: the stage is the deliverable's shape, not the source's.
  expect(stage.style.aspectRatio).toBe('1080 / 1920')
  expect(stage).toHaveClass('player__stage--format')
})

test('each shot is framed on the stage the way its layout will render it', async () => {
  const cropped = makeClip({
    id: 'clip-a',
    title: 'first',
    layout: 'smart_crop',
    crop_center_x: 30,
  })
  await openPlayer(makeBatch({ clips: [cropped, second] }))

  const [active] = stageVideos()
  await waitFor(() => expect(active).toHaveClass('player__video--smart_crop'))
  // The crop centre the operator chose is what the stage crops to.
  expect(active.style.getPropertyValue('--crop-x')).toBe('30%')
})

test('a fitted landscape picture reaches the stage edges at default framing', async () => {
  await openPlayer(makeBatch())

  const [active] = stageVideos()
  await waitFor(() => expect(active).toHaveClass('player__video--fit_background'))
  expect(active.style.getPropertyValue('--fit-left')).toBe('0%')
  expect(active.style.getPropertyValue('--fit-width')).toBe('100%')
})

test('the source view shows the whole frame and outlines what survives', async () => {
  const cropped = makeClip({
    id: 'clip-a',
    title: 'first',
    layout: 'smart_crop',
    crop_center_x: 50,
  })
  const player = await openPlayer(makeBatch({ clips: [cropped, second] }))
  openPlaybackOptions(player)

  fireEvent.click(within(player).getByRole('button', { name: /Source/ }))

  const stage = document.querySelector<HTMLElement>('.player__stage')!
  // Now the source's own shape, uncropped, with the kept slice drawn on it.
  expect(stage.style.aspectRatio).toBe('1920 / 1080')
  const [active] = stageVideos()
  expect(active).toHaveClass('player__video--whole')

  const kept = document.querySelector<HTMLElement>('.player__kept')!
  expect(kept).toBeTruthy()
  expect(parseFloat(kept.style.width)).toBeCloseTo(31.64, 1)
  expect(within(player).getByText(/what the vertical crop keeps/)).toBeVisible()
})

test('a fitted shot outlines nothing, because it discards nothing', async () => {
  // fit_background pads the whole frame in rather than cropping it, so an
  // outline would claim a loss that does not happen.
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  fireEvent.click(within(player).getByRole('button', { name: /Source/ }))

  expect(document.querySelector('.player__kept')).toBeNull()
})

test('the scrub bar reports the whole sequence, whatever the timeline shows', async () => {
  const player = await openPlayer(makeBatch())

  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  // Two Shots, five and three seconds.
  expect(scrub).toHaveAttribute('aria-valuemax', '8000')
  expect(scrub).toHaveAttribute('aria-valuenow', '0')

  fireEvent.keyDown(scrub, { key: 'End' })
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '8000'))
  expect(within(player).getByText('00:08:00 / 00:08:00')).toBeVisible()
})

test('the scrub bar ticks every join and shades every cutaway', async () => {
  const player = await openPlayer(
    makeBatch({
      shots: [makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 })],
      cutaways: [cutaway],
    }),
  )

  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  // One Shot, so no join to tick — the Sequence's own start is the bar's edge.
  expect(scrub.querySelectorAll('.scrub__join')).toHaveLength(0)
  // The Cutaway runs 1s to 3s of a 5s Shot.
  const shaded = scrub.querySelector<HTMLElement>('.scrub__cutaway')!
  expect(shaded.style.left).toBe('20%')
  expect(shaded.style.width).toBe('40%')
})

test('two shots put a join on the scrub bar where the cut falls', async () => {
  const player = await openPlayer(makeBatch())

  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  const joins = scrub.querySelectorAll<HTMLElement>('.scrub__join')
  expect(joins).toHaveLength(1)
  // The cut is five seconds into an eight-second Sequence.
  expect(joins[0].style.left).toBe('62.5%')
})

test('scrubbing moves the playhead and the shot it lands on', async () => {
  const player = await openPlayer(makeBatch())

  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })

  // A tenth of an eight-second Sequence, capped at a second.
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '800'))
  expect(within(player).getByText('shot 1 of 2')).toBeInTheDocument()

  fireEvent.keyDown(scrub, { key: 'End' })
  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeInTheDocument())
})

test('the speed survives a cut, on whichever element becomes visible', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  fireEvent.click(within(player).getByRole('button', { name: '2×' }))

  // Both elements, not just the visible one: the idle one becomes visible at
  // the next join, and a rate set on only one would reset itself there.
  const [active, idle] = stageVideos()
  await waitFor(() => expect(active.playbackRate).toBe(2))
  expect(idle.playbackRate).toBe(2)

  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))
  fireEvent.ended(active)

  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeInTheDocument())
  expect(stageVideos()[1].playbackRate).toBe(2)
})

test('muting silences the element carrying the sound, not the structure', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  const [active, idle] = stageVideos()
  // The idle element is muted because it is not the sound source. That is
  // structural and has nothing to do with the operator's mute.
  expect(active.muted).toBe(false)
  expect(idle.muted).toBe(true)

  fireEvent.click(within(player).getByRole('button', { name: 'Mute' }))

  await waitFor(() => expect(stageVideos()[0].muted).toBe(true))
  expect(stageVideos()[1].muted).toBe(true)

  fireEvent.click(within(player).getByRole('button', { name: 'Unmute' }))
  await waitFor(() => expect(stageVideos()[0].muted).toBe(false))
  // Still muted: it is still not the sound source.
  expect(stageVideos()[1].muted).toBe(true)
})

test('the volume reaches every element', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  fireEvent.change(within(player).getByLabelText('Volume'), { target: { value: '0.4' } })

  await waitFor(() => expect(stageVideos()[0].volume).toBeCloseTo(0.4))
  expect(stageVideos()[1].volume).toBeCloseTo(0.4)
})

test('stepping a frame moves by the clip’s own frame rate, and stops playback', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  fireEvent.click(within(player).getByRole('button', { name: 'Forward one frame' }))

  // 30 fps, so one frame is 33ms. Stepping while playing is meaningless, so
  // it stops first.
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '33'))
  expect(within(player).getByRole('button', { name: 'Play the rough cut' })).toBeVisible()
})

test('jumping to a cut parks the playhead exactly on the join', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })

  fireEvent.click(within(player).getByRole('button', { name: 'Next cut' }))

  // The join is five seconds in, not a frame either side of it.
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '5000'))
  expect(within(player).getByText('shot 2 of 2')).toBeInTheDocument()

  fireEvent.click(within(player).getByRole('button', { name: 'Previous cut' }))
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '0'))
})

test('looping a shot is the review range with its edges set, not a second loop', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  // Selecting the second shot on the timeline, then looping it.
  // The timeline selects a shot on focus, which is how a keyboard reaches it.
  fireEvent.focus(await screen.findByRole('button', { name: /second, shot 2 of 2/ }))
  fireEvent.click(within(player).getByRole('button', { name: /This shot/ }))

  // One mechanism: the range now holds the shot's edges and looping is on.
  await waitFor(() => expect(within(player).getByText('00:05.0–00:08.0')).toBeVisible())
  expect(within(player).getByRole('button', { name: /Loop/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  expect(scrub).toHaveAttribute('aria-valuenow', '5000')
})

test('a marked range loops back rather than running to the end', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  // Mark a range over the first two seconds.
  fireEvent.keyDown(window, { key: '[' })
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '1600'))
  fireEvent.keyDown(window, { key: ']' })
  fireEvent.keyDown(window, { key: 'r' })

  await waitFor(() =>
    expect(within(player).getByRole('button', { name: /Loop/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    ),
  )

  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))
  const [active] = stageVideos()
  // Past the range's out-point, but nowhere near the shot's end.
  tick(active, 2)

  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '0'))
  // Still playing: looping is not stopping.
  expect(within(player).getByRole('button', { name: 'Pause the rough cut' })).toBeVisible()
})

test('the keyboard drives the player from anywhere on the page', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  fireEvent.keyDown(window, { key: ' ' })
  await waitFor(() =>
    expect(within(player).getByRole('button', { name: 'Pause the rough cut' })).toBeVisible(),
  )

  fireEvent.keyDown(window, { key: '3' })
  await waitFor(() => expect(stageVideos()[0].playbackRate).toBe(1.5))

  fireEvent.keyDown(window, { key: 'm' })
  await waitFor(() => expect(within(player).getByRole('button', { name: 'Unmute' })).toBeVisible())

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '5000'))
})

test('typing a batch name is not a stream of shortcuts', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  fireEvent.click(await screen.findByRole('button', { name: /Rename/ }))
  const field = await screen.findByLabelText('Batch name')

  // Every one of these is a shortcut. None may fire while typing.
  fireEvent.keyDown(field, { key: ' ' })
  fireEvent.keyDown(field, { key: 'm' })
  fireEvent.keyDown(field, { key: 'r' })
  fireEvent.keyDown(field, { key: '2' })

  expect(within(player).getByRole('button', { name: 'Play the rough cut' })).toBeVisible()
  expect(within(player).getByRole('button', { name: 'Mute' })).toBeVisible()
  expect(within(player).getByRole('button', { name: /Loop/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(stageVideos()[0].playbackRate).toBe(1)
})

test('the scrub bar owns the arrows while it has focus', async () => {
  // Both the bar and the page keymap want the arrow keys. Pressing one must
  // not scrub AND step a frame.
  const player = await openPlayer(makeBatch())
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })

  fireEvent.keyDown(scrub, { key: 'ArrowRight' })

  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '800'))
})

test('trimming to the playhead is offered only for the shot it is inside', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  // Nothing selected: there is no shot to trim.
  expect(within(player).getByRole('button', { name: 'In to playhead' })).toBeDisabled()
  expect(within(player).getByText(/Select the shot the playhead is inside/)).toBeVisible()

  // Selecting the SECOND shot while the playhead sits in the first is exactly
  // the case that must stay refused — trimming it would make a cut nobody saw.
  fireEvent.focus(await screen.findByRole('button', { name: /second, shot 2 of 2/ }))
  await waitFor(() =>
    expect(within(player).getByRole('button', { name: 'In to playhead' })).toBeDisabled(),
  )

  fireEvent.focus(await screen.findByRole('button', { name: /first, shot 1 of 2/ }))
  await waitFor(() =>
    expect(within(player).getByRole('button', { name: 'In to playhead' })).toBeEnabled(),
  )
})

test('trimming to the playhead sends only the edge that moved', async () => {
  const fetchMock = stubApi(makeBatch())
  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  const player = await screen.findByRole('region', { name: 'Player' })
  openPlaybackOptions(player)

  fireEvent.focus(await screen.findByRole('button', { name: /first, shot 1 of 2/ }))
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })
  await waitFor(() => expect(scrub).toHaveAttribute('aria-valuenow', '800'))

  fireEvent.click(within(player).getByRole('button', { name: 'In to playhead' }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/batches/batch-1/shots/shot-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ trim_start_ms: 800 }),
      }),
    ),
  )
})

test('trimming to the playhead will not leave a shot too short to see', async () => {
  const fetchMock = stubApi(makeBatch())
  renderApp(newClient(), '/modes/batch-process/batches/batch-1')
  const player = await screen.findByRole('region', { name: 'Player' })
  openPlaybackOptions(player)

  fireEvent.focus(await screen.findByRole('button', { name: /first, shot 1 of 2/ }))
  // At the very start of the shot, an out-point here would leave nothing.
  fireEvent.click(within(player).getByRole('button', { name: 'Out to playhead' }))

  await waitFor(() => expect(within(player).getByText('shot 1 of 2')).toBeInTheDocument())
  expect(fetchMock).not.toHaveBeenCalledWith(
    '/api/batches/batch-1/shots/shot-1',
    expect.objectContaining({ method: 'PATCH' }),
  )
})

const talking = makeClip({
  id: 'clip-a',
  title: 'first',
  captions: [
    { id: 'cap-1', sequence: 0, start_ms: 0, end_ms: 2000, text: 'and then it broke', edited: false },
    { id: 'cap-2', sequence: 1, start_ms: 2000, end_ms: 4000, text: 'which nobody expected', edited: false },
  ],
})

test('the subtitle on the stage is the one that will be burned in', async () => {
  const player = await openPlayer(makeBatch({ clips: [talking, second] }))

  expect(within(player).getByText('and then it broke')).toBeVisible()

  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })

  // Past two seconds, so the next segment.
  await waitFor(() => expect(within(player).getByText('which nobody expected')).toBeVisible())
  expect(within(player).queryByText('and then it broke')).not.toBeInTheDocument()
})

test('a clip with subtitles switched off shows none', async () => {
  const silent = makeClip({ ...talking, id: 'clip-a', title: 'first', captions_enabled: false })
  const player = await openPlayer(makeBatch({ clips: [silent, second] }))

  expect(within(player).queryByText('and then it broke')).not.toBeInTheDocument()
})

test('no subtitle burns in under a cutaway, from either clip', async () => {
  // The export renders a covered span as the Cutaway's picture with captions
  // off, so nothing is burned in there — not the Cutaway's own, which
  // transcribe audio nobody hears, and not the base Shot's either.
  const cover = makeClip({
    id: 'clip-b',
    title: 'second',
    captions: [
      { id: 'cap-b', sequence: 0, start_ms: 0, end_ms: 3000, text: 'b-roll words', edited: false },
    ],
  })
  const player = await openPlayer(
    makeBatch({
      clips: [talking, cover],
      shots: [makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 })],
      cutaways: [cutaway],
    }),
  )

  // Uncovered at the start: the base Shot's subtitle is showing.
  expect(within(player).getByText('and then it broke')).toBeVisible()

  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))
  const [active] = stageVideos()
  tick(active, 1.2)

  await waitFor(() =>
    expect(within(player).queryByText('and then it broke')).not.toBeInTheDocument(),
  )
  expect(within(player).queryByText('b-roll words')).not.toBeInTheDocument()
})

test('an overlay is drawn where and when the export burns it', async () => {
  const branded = makeClip({
    id: 'clip-a',
    title: 'first',
    image_overlays: [
      {
        id: 'ov-1',
        name: 'logo',
        url: '/media/logo.png',
        mime_type: 'image/png',
        size_bytes: 4096,
        start_ms: 1000,
        end_ms: 3000,
        center_x: 70,
        center_y: 20,
        width_percent: 30,
        rotation_deg: 12,
        opacity: 0.8,
      },
    ],
  })
  const player = await openPlayer(makeBatch({ clips: [branded, second] }))
  const scrub = within(player).getByRole('slider', { name: 'Sequence position' })

  // Before its span.
  expect(document.querySelector('.player__overlay')).toBeNull()

  fireEvent.keyDown(scrub, { key: 'ArrowRight' })
  fireEvent.keyDown(scrub, { key: 'ArrowRight' })

  await waitFor(() => expect(document.querySelector('.player__overlay')).not.toBeNull())
  const overlay = document.querySelector<HTMLElement>('.player__overlay')!
  expect(overlay.style.left).toBe('70%')
  expect(overlay.style.top).toBe('20%')
  expect(overlay.style.width).toBe('30%')
  expect(overlay.style.transform).toContain('rotate(12deg)')
})

test('the safe area is offered, and off until asked for', async () => {
  const player = await openPlayer(makeBatch())
  openPlaybackOptions(player)

  expect(document.querySelector('.safe-area')).toBeNull()
  fireEvent.click(within(player).getByRole('button', { name: /Safe area/ }))
  await waitFor(() => expect(document.querySelector('.safe-area')).not.toBeNull())
})

test('the cutaway badge names the picture and the sound', async () => {
  const player = await openPlayer(
    makeBatch({
      shots: [makeShot({ id: 'shot-1', clip_id: 'clip-a', position: 0 })],
      cutaways: [cutaway],
    }),
  )
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  tick(active, 1.2)

  await waitFor(() => expect(within(player).getByText('Cutaway')).toBeVisible())
  // Whose sound you are hearing, on the picture itself.
  const badge = document.querySelector('.player__badge')!
  expect(within(badge as HTMLElement).getByText('first')).toBeVisible()
})

test('a smart-cropped shot says its framing is approximate, and a fitted one does not', async () => {
  const smart = makeClip({ id: 'clip-a', title: 'first', layout: 'smart_crop' })
  const player = await openPlayer(makeBatch({ clips: [smart, second] }))
  openPlaybackOptions(player)

  expect(within(player).getByText(/crop follows faces on export/)).toBeVisible()

  // The second shot is fitted whole, so nothing about it is approximate.
  fireEvent.click(within(player).getByRole('button', { name: 'Next cut' }))
  await waitFor(() =>
    expect(within(player).queryByText(/crop follows faces on export/)).not.toBeInTheDocument(),
  )
})
