import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force Vite to use ONE copy of React — prevents recharts "invalid hook" error
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'reactVendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              includeDependenciesRecursively: true,
              priority: 20,
            },
            {
              name: 'charts',
              test: /node_modules/,
              priority: 10,
            },
          ],
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
