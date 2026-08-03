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
): Shot => ({ trim_start_ms: null, trim_end_ms: null, ...overrides })

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
  await waitFor(() => expect(within(player).getByText('shot 1 of 2')).toBeVisible())

  // Past its Trim end. The Sequence must move on rather than stall.
  tick(active, 5)
  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeVisible())
  expect(within(player).getByText('second')).toBeVisible()
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

  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeVisible())
})

test('a shot short of both its trim and its media keeps playing', async () => {
  // The other side of it: ending a Shot early would cut the Sequence short.
  const player = await openPlayer(makeBatch())
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  setDuration(active, 4.8)
  tick(active, 3)

  await waitFor(() => expect(within(player).getByText('shot 1 of 2')).toBeVisible())
})

test('the media ending advances even when timeupdate has stopped firing', async () => {
  const player = await openPlayer(makeBatch())
  fireEvent.click(within(player).getByRole('button', { name: 'Play the rough cut' }))

  const [active] = stageVideos()
  fireEvent.ended(active)

  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeVisible())
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
  expect(within(player).getByText('00:05.0 / 00:05.0')).toBeVisible()
})

const cutaway: Cutaway = {
  id: 'cut-1',
  clip_id: 'clip-b',
  base_shot_id: 'shot-1',
  offset_ms: 1000,
  trim_start_ms: 0,
  trim_end_ms: 2000,
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

test('the source view shows the whole frame and outlines what survives', async () => {
  const cropped = makeClip({
    id: 'clip-a',
    title: 'first',
    layout: 'smart_crop',
    crop_center_x: 50,
  })
  const player = await openPlayer(makeBatch({ clips: [cropped, second] }))

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
  expect(within(player).getByText('00:08.0 / 00:08.0')).toBeVisible()
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
  expect(within(player).getByText('shot 1 of 2')).toBeVisible()

  fireEvent.keyDown(scrub, { key: 'End' })
  await waitFor(() => expect(within(player).getByText('shot 2 of 2')).toBeVisible())
})
