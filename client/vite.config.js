import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': process.env.VITE_API || 'http://localhost:3000' } },
  build: {
    outDir: '../server/public', emptyOutDir: true,
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-|victory-vendor|decimal\.js)/, priority: 20 },
      { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 10 },
    ] } } },
  },
})
