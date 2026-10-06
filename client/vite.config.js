import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': process.env.VITE_API || 'http://localhost:3000' } },
  build: { outDir: '../server/public', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
