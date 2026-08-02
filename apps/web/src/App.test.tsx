import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from './App'
import type { Project } from './types'

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

test('explains the X-to-vertical mode before opening the importer', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client)

  expect(screen.getByRole('heading', { name: 'Choose what you want to make.' })).toBeInTheDocument()
  expect(screen.getByText(/Take a landscape video from an X post/)).toHaveTextContent('ready to upload')
  fireEvent.click(screen.getByRole('button', { name: /Landscape X to Vertical/ }))

  expect(screen.getByTestId('location')).toHaveTextContent('/modes/x-to-vertical')
  expect(await screen.findByLabelText('X post URL')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  expect(screen.getByText('Authorized content only')).toBeInTheDocument()
})

test('shows detailed diagnostics for a failed import', async () => {
  const failedProject: Project = {
    id: 'project-1',
    mode: 'x-to-vertical',
    origin_kind: 'x',
    batch_id: null,
    source_url: 'https://x.com/i/status/123',
    source_post_id: '123',
    title: 'Failed clip',
    source_caption: null,
    social_caption: null,
    status: 'failed',
    transcription_status: 'pending',
    error_message: 'Stage: Reading X post\nError type: SourceDownloadError\nMessage: Cookie configuration is invalid',
    duration_ms: null,
    width: null,
    height: null,
    fps: null,
    trim_start_ms: 0,
    trim_end_ms: null,
    layout: 'fit_background',
    crop_center_x: 50,
    captions_enabled: true,
    caption_style: 'bold',
    caption_position: 'bottom',
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:01:00Z',
    artifacts: [],
    captions: [],
    image_overlays: [],
    renders: [],
    latest_job: {
      id: 'job-1',
      project_id: 'project-1',
      render_id: null,
      kind: 'import',
      status: 'failed',
      progress: 4,
      message: 'Import failed while reading x post',
      attempts: 2,
      error_message: 'Stage: Reading X post\nError type: SourceDownloadError\nMessage: Cookie configuration is invalid',
      created_at: '2026-07-16T12:00:00Z',
      started_at: '2026-07-16T12:00:15Z',
      completed_at: '2026-07-16T12:01:00Z',
    },
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [failedProject],
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client)

  fireEvent.click(screen.getByRole('button', { name: /Landscape X to Vertical/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Import failed while reading x post')
  expect(screen.getByText(/Error type: SourceDownloadError/)).toBeVisible()
  expect(screen.getByText('Attempts').nextSibling).toHaveTextContent('2')
})

test('previews caption presets and unsaved caption edits', async () => {
  const readyProject: Project = {
    id: 'project-ready',
    mode: 'x-to-vertical',
    origin_kind: 'x',
    batch_id: null,
    source_url: 'https://x.com/i/status/456',
    source_post_id: '456',
    title: 'Ready clip',
    source_caption: 'A useful source post',
    social_caption: 'A useful source post',
    status: 'ready',
    transcription_status: 'complete',
    error_message: null,
    duration_ms: 5000,
    width: 1920,
    height: 1080,
    fps: 30,
    trim_start_ms: 0,
    trim_end_ms: 5000,
    layout: 'smart_crop',
    crop_center_x: 50,
    captions_enabled: true,
    caption_style: 'bold',
    caption_position: 'bottom',
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:01:00Z',
    artifacts: [],
    captions: [{
      id: 'caption-1',
      sequence: 0,
      start_ms: 0,
      end_ms: 1200,
      text: 'Original caption',
      edited: false,
    }],
    image_overlays: [{
      id: 'image-1',
      name: 'callout.png',
      start_ms: 0,
      end_ms: 3000,
      center_x: 50,
      center_y: 50,
      width_percent: 65,
      rotation_deg: 0,
      opacity: 1,
      mime_type: 'image/png',
      size_bytes: 1024,
      url: '/api/artifacts/image-1',
    }],
    renders: [],
    latest_job: null,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [readyProject],
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client, '/modes/x-to-vertical/projects/project-ready')

  fireEvent.click(await screen.findByRole('button', { name: /Captions 1/ }))
  const minimal = screen.getByRole('radio', { name: /Minimal, DejaVu Sans, 56 pixels/ })
  fireEvent.click(minimal)
  expect(minimal).toHaveAttribute('aria-checked', 'true')
  const topPlacement = screen.getByRole('radio', { name: 'Place captions at top' })
  fireEvent.click(topPlacement)
  expect(topPlacement).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText('Top placement')).toBeVisible()
  expect(document.querySelector('.caption-preview')).toHaveClass('caption-preview--position-top')

  const captionEditor = screen.getByRole('textbox')
  fireEvent.change(captionEditor, { target: { value: 'Edited before saving' } })
  expect(captionEditor).toHaveValue('Edited before saving')
  expect(document.querySelector('.caption-preview')).toHaveTextContent('Edited before saving')
  expect(document.querySelector('.caption-style-preview__text')).toHaveTextContent('Edited before saving')

  fireEvent.click(screen.getByRole('button', { name: 'Post' }))
  const socialCaptionFields = screen.getAllByRole('textbox')
  expect(socialCaptionFields).toHaveLength(2)
  expect(socialCaptionFields[0]).toHaveAttribute('readonly')
  expect(socialCaptionFields[0]).toHaveValue('A useful source post')
  expect(screen.getByRole('button', { name: 'Rewrite & censor' })).toBeEnabled()

  fireEvent.click(screen.getByRole('button', { name: /Images 1/ }))
  expect(screen.getByText(/Drag in the preview to move/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Fit safe' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reset' })).toBeVisible()
})

test('deletes one video or clears the full video library after confirmation', async () => {
  const makeProject = (id: string, title: string): Project => ({
    id,
    mode: 'x-to-vertical',
    origin_kind: 'x',
    batch_id: null,
    source_url: `https://x.com/i/status/${id}`,
    source_post_id: id,
    title,
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
    layout: 'smart_crop',
    crop_center_x: 50,
    captions_enabled: true,
    caption_style: 'bold',
    caption_position: 'bottom',
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:01:00Z',
    artifacts: [],
    captions: [],
    image_overlays: [],
    renders: [],
    latest_job: null,
  })
  const projects = [makeProject('first', 'First video'), makeProject('second', 'Second video')]
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
    ok: true,
    json: async () => init?.method === 'DELETE' ? { deleted: 1 } : projects,
  }))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client, '/modes/x-to-vertical/projects/first')

  fireEvent.click(await screen.findByRole('button', { name: 'Delete First video' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Delete this video?')
  fireEvent.click(screen.getByRole('button', { name: 'Delete video' }))

  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/modes/x-to-vertical/projects/second'))
  expect(fetchMock).toHaveBeenCalledWith('/api/projects/first', expect.objectContaining({ method: 'DELETE' }))

  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
  const clearDialog = screen.getByRole('dialog')
  expect(clearDialog).toHaveTextContent('Clear every video?')
  fireEvent.click(within(clearDialog).getByRole('button', { name: 'Clear all' }))

  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/modes/x-to-vertical/new'))
  expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'DELETE' }))
  expect(await screen.findByLabelText('X post URL')).toBeInTheDocument()
})

test('shows Instagram setup requirements in connected apps settings', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{
      platform: 'instagram',
      display_name: 'Instagram',
      configured: false,
      missing_configuration: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'TOKEN_ENCRYPTION_KEY'],
      account: null,
    }],
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client, '/settings')

  expect(screen.getByRole('heading', { name: 'Your publishing connections.' })).toBeVisible()
  expect(await screen.findByText('Setup required')).toBeVisible()
  expect(screen.getByText('INSTAGRAM_APP_ID')).toBeVisible()
  expect(screen.getByRole('button', { name: /Connect Instagram/ })).toBeDisabled()
  expect(screen.getByText(/Tokens are encrypted at rest/)).toBeVisible()
})

test('shows and disconnects a connected Instagram account', async () => {
  const account = {
    id: 'account-1',
    platform: 'instagram',
    remote_user_id: '456',
    username: 'clipfarmer',
    display_name: 'Clip Farmer',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    status: 'connected',
    token_expires_at: '2026-09-14T12:00:00Z',
    connected_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:00:00Z',
  }
  let connected = true
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      connected = false
      return { ok: true, json: async () => ({ deleted: 1 }) }
    }
    return {
      ok: true,
      json: async () => [{
        platform: 'instagram',
        display_name: 'Instagram',
        configured: true,
        missing_configuration: [],
        account: connected ? account : null,
      }],
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client, '/settings?instagram=connected')

  expect(await screen.findByText('@clipfarmer')).toBeVisible()
  expect(screen.getByText(/Instagram connected/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Disconnect @clipfarmer?')
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Disconnect' }))

  await waitFor(() => expect(screen.getByText('Not connected')).toBeVisible())
  expect(fetchMock).toHaveBeenCalledWith('/api/platforms/instagram', expect.objectContaining({ method: 'DELETE' }))
})

test('posts a completed render to Instagram through the backend', async () => {
  const project: Project = {
    id: 'project-post',
    mode: 'x-to-vertical',
    origin_kind: 'x',
    batch_id: null,
    source_url: 'https://x.com/i/status/789',
    source_post_id: '789',
    title: 'Postable clip',
    source_caption: 'Source caption',
    social_caption: 'Reel caption',
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
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:01:00Z',
    artifacts: [],
    captions: [],
    image_overlays: [],
    renders: [{
      id: 'render-1',
      status: 'complete',
      size_bytes: 1024,
      duration_ms: 5000,
      layout: 'fit_background',
      error_message: null,
      created_at: '2026-07-16T12:01:00Z',
      download_url: '/api/renders/render-1/download',
      publications: [],
    }],
    latest_job: null,
  }
  const queuedJob = {
    id: 'publish-job-1',
    project_id: project.id,
    render_id: 'render-1',
    kind: 'publish_instagram',
    status: 'queued',
    progress: 0,
    message: 'Queued for Instagram',
    attempts: 0,
    error_message: null,
    created_at: '2026-07-16T12:02:00Z',
    started_at: null,
    completed_at: null,
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/platforms') {
      return {
        ok: true,
        json: async () => [{
          platform: 'instagram',
          display_name: 'Instagram',
          configured: true,
          missing_configuration: [],
          account: {
            id: 'account-1',
            platform: 'instagram',
            remote_user_id: 'ig-user-1',
            username: 'clipfarmer',
            display_name: null,
            scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
            status: 'connected',
            token_expires_at: null,
            connected_at: '2026-07-16T12:00:00Z',
            updated_at: '2026-07-16T12:00:00Z',
          },
        }],
      }
    }
    if (path === '/api/renders/render-1/publish/instagram') {
      return { ok: true, json: async () => queuedJob }
    }
    if (path === '/api/jobs/publish-job-1') {
      return {
        ok: true,
        json: async () => ({
          ...queuedJob,
          status: 'complete',
          progress: 100,
          message: 'Reel posted to Instagram',
        }),
      }
    }
    if (init?.method === 'PUT') return { ok: true, json: async () => project }
    return { ok: true, json: async () => [project] }
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  renderApp(client, '/modes/x-to-vertical/projects/project-post')

  fireEvent.click(await screen.findByRole('button', { name: 'Post to Instagram' }))

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/renders/render-1/publish/instagram',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ caption: 'Reel caption', share_to_feed: true }),
    }),
  ))
  expect(await screen.findByText('Reel posted to Instagram')).toBeVisible()
})
