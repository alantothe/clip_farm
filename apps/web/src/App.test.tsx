import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from './App'


test('opens directly on the X post importer', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )

  expect(await screen.findByLabelText('X post URL')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  expect(screen.getByText('Authorized content only')).toBeInTheDocument()
})

