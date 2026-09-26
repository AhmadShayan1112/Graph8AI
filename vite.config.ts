import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const api = { target: 'http://localhost:3001', changeOrigin: true }

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      // Deployed MVP sites live at /<slug>, same as on Vercel.
      '^/[a-z0-9]+(?:-[a-z0-9]+)*/?$': api,
    },
  },
})
