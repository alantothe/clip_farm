import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { CoverStackPage, drawCoverPanel } from './CoverStackPage'

class LoadedImage {
  naturalWidth = 1600
  naturalHeight = 1200
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('loads four photos and opens one strip in the full editor', async () => {
  vi.stubGlobal('Image', LoadedImage)
  const NativeUrl = URL
  class BrowserUrl extends NativeUrl {
    static createObjectURL = vi.fn(() => `blob:photo-${Math.random()}`)
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', BrowserUrl)
  const { container } = render(<CoverStackPage />)
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const files = Array.from({ length: 4 }, (_, index) => (
    new File([`photo ${index}`], `photo-${index + 1}.jpg`, { type: 'image/jpeg' })
  ))

  fireEvent.change(input, { target: { files } })

  expect(await screen.findByText('Ready to frame')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Download cover' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /Edit photo 1/ }))

  expect(screen.getByRole('dialog', { name: 'Frame this strip' })).toBeVisible()
  const zoom = screen.getByRole('slider', { name: 'Photo 1 zoom' })
  fireEvent.change(zoom, { target: { value: '2' } })
  await waitFor(() => expect(screen.getByText('2.00×')).toBeVisible())
  fireEvent.click(screen.getByRole('button', { name: 'Close photo editor' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('draws a wide photo into exactly one 1080 by 480 panel', () => {
  const drawImage = vi.fn()
  const rect = vi.fn()
  drawCoverPanel(
    { drawImage, rect, save: vi.fn(), beginPath: vi.fn(), clip: vi.fn(), restore: vi.fn() } as unknown as CanvasRenderingContext2D,
    {} as CanvasImageSource,
    { width: 1600, height: 900, zoom: 1, positionX: 50, positionY: 50 },
    2,
  )

  expect(rect).toHaveBeenCalledWith(0, 960, 1080, 480)
  expect(drawImage).toHaveBeenCalledWith(
    expect.anything(),
    0,
    896.25,
    1080,
    607.5,
  )
})
