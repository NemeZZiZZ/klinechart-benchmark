import path from 'node:path'
import { defineConfig } from 'vite'

// Point KLINE_BENCH_LOCAL at a local klinecharts source entry to benchmark
// a checkout instead of the pinned npm release, e.g.:
//   KLINE_BENCH_LOCAL=../KLineChart/src/index.ts pnpm dev
// Relative paths are resolved against the current working directory
// (the project root when Vite is started from it).
const localSource = process.env.KLINE_BENCH_LOCAL

const alias = localSource ? [{ find: /^klinecharts$/, replacement: path.resolve(localSource) }] : []

export default defineConfig({
  base: './',
  resolve: { alias },
  server: {
    port: 5199,
    strictPort: true
  }
})
