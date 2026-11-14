import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site at https://<user>.github.io/event-pos/
// Override with VITE_BASE if the repo name or host changes (e.g. VITE_BASE=/ for a custom domain).
const base = process.env.VITE_BASE ?? '/event-pos/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload a till by surprise in the middle of a sale: the app shows an "Update" button instead.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Event POS',
        short_name: 'Event POS',
        description: 'Point of sale for the event',
        theme_color: '#0f766e',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The whole app shell is precached, so the till opens even with no / poor wifi.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Supabase API calls are never cached by the service worker — the app keeps its own offline data.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { chunkSizeWarningLimit: 900 },
})
