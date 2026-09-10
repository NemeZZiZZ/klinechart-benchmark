import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'size-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        klinecharts: fileURLToPath(new URL('./size/klinecharts.html', import.meta.url)),
        'lightweight-charts': fileURLToPath(new URL('./size/lightweight-charts.html', import.meta.url)),
        echarts: fileURLToPath(new URL('./size/echarts.html', import.meta.url))
      }
    }
  }
})
