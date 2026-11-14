import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves the site at https://<user>.github.io/event-pos/
// Override with VITE_BASE if the repo name or host changes (e.g. VITE_BASE=/ for a custom domain).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/event-pos/',
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 900 },
})
