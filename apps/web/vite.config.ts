import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // Tests assert on bare request paths, so the API base must stay empty even
    // when a local .env.local points the dev build at a deployed API.
    env: {
      VITE_API_BASE_URL: '',
    },
  },
})
