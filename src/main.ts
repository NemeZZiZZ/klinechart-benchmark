import { runBenchmark } from './runner'
import { setupUI } from './ui'

declare global {
  interface Window {
    __runBenchmark__: typeof runBenchmark
    __BENCH_READY__: boolean
  }
}

setupUI()

window.__runBenchmark__ = runBenchmark
window.__BENCH_READY__ = true
