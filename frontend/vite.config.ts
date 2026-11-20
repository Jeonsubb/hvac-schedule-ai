import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8000', changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // ECharts (~560 kB) only loads with the screens that draw charts
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'echarts', test: /node_modules[\\/](echarts|zrender|echarts-for-react)[\\/]/ }],
        },
      },
    },
  },
})
