import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    allowedHosts: ['.loca.lt'],
    proxy: {
      '/api': 'http://localhost:5001'
    }
  },
  build: {
    outDir: 'dist'
  }
})
