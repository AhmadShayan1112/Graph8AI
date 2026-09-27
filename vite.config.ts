import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const api = { target: 'http://localhost:3001', changeOrigin: true }

export default defineConfig({
  plugins: [react()],
  // The deployed commit, so an open tab can tell when a newer version is live (see UpdateBanner).
  define: { __APP_COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)) },
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      // Deployed MVP sites live at /<slug>, same as on Vercel.
      '^/[a-z0-9]+(?:-[a-z0-9]+)*/?$': api,
    },
  },
})
