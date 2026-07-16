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
    source_url: 'https://x.com/i/status/123',
    source_post_id: '123',
    title: 'Failed clip',
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
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:01:00Z',
    artifacts: [],
    captions: [],
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
    source_url: 'https://x.com/i/status/456',
    source_post_id: '456',
    title: 'Ready clip',
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
  expect(screen.getByText('Bottom · 13% safe')).toBeVisible()

  const captionEditor = screen.getByRole('textbox')
  fireEvent.change(captionEditor, { target: { value: 'Edited before saving' } })
  expect(captionEditor).toHaveValue('Edited before saving')
  expect(document.querySelector('.caption-preview')).toHaveTextContent('Edited before saving')
  expect(document.querySelector('.caption-style-preview__text')).toHaveTextContent('Edited before saving')
})

test('deletes one video or clears the full video library after confirmation', async () => {
  const makeProject = (id: string, title: string): Project => ({
    id,
    source_url: `https://x.com/i/status/${id}`,
    source_post_id: id,
    title,
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
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:01:00Z',
    artifacts: [],
    captions: [],
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
