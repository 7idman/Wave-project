import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force Vite to use ONE copy of React — prevents recharts "invalid hook" error
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code (React, recharts) changes far less often than the app
        // itself — splitting it into its own chunk means a returning user's
        // browser can keep it cached across deploys, only re-downloading
        // the (smaller) app chunk when something in PlatformApp.tsx changes.
        // This is a build-config-only change — no application code moved.
        manualChunks: {
          vendor: ['react', 'react-dom', 'recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      }
    }
  }
})
