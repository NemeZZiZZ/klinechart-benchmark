import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const resultsDir = path.join(packageRoot, 'results')

const args = process.argv.slice(2)
const headless = args.includes('--headless')

function parseVolumes() {
  const flag = args.find((arg) => arg.startsWith('--volumes='))
  if (flag === undefined) {
    return [5000, 10000, 20000, 50000, 100000, 200000]
  }
  const volumes = flag
    .slice('--volumes='.length)
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
  return volumes.length > 0 ? volumes : [5000]
}

function waitForServer(port, timeoutMs = 30000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    function attempt() {
      const request = httpGet({ port, path: '/', timeout: 2000 }, (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          retry()
          return
        }
        // Verify the benchmark page itself answered, not some other server on this port.
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          if (body.includes('<title>KLineChart Benchmark</title>')) {
            resolve()
          } else {
            retry()
          }
        })
        response.on('error', retry)
      })
      request.on('error', retry)
    }
    function retry() {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`vite dev server on port ${port} did not become ready`))
        return
      }
      setTimeout(attempt, 500)
    }
    attempt()
  })
}

function runBundleSize() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, 'size.mjs'), '--json'], { cwd: packageRoot }, (error, stdout) => {
      if (error) {
        console.warn(`bundle size measurement failed: ${error.message}`)
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        resolve(undefined)
      }
    })
  })
}

function formatCell(value, scenario) {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'number') {
    if (scenario === 'heapDelta') {
      return `${(value / 1024 / 1024).toFixed(1)} MB`
    }
    if (scenario === 'tickUpdates') {
      return value.toFixed(4)
    }
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(3)
  }
  return String(value)
}

function printResults(bench) {
  const libs = Object.keys(bench.meta.versions)
  for (const [scenario, volumes] of Object.entries(bench.results)) {
    console.log(`\n=== ${scenario} ===`)
    const header = ['volume', ...libs].map((value) => value.padEnd(20)).join('')
    console.log(header)
    for (const [volume, values] of Object.entries(volumes)) {
      const row = [volume, ...libs.map((lib) => formatCell(values[lib], scenario))]
      console.log(row.map((value) => value.padEnd(20)).join(''))
    }
  }
  const heapDelta = bench.results.heapDelta
  if (heapDelta !== undefined) {
    console.log('\n=== heapPerBar (KB per bar, derived) ===')
    const header = ['volume', ...libs].map((value) => value.padEnd(20)).join('')
    console.log(header)
    for (const [volume, values] of Object.entries(heapDelta)) {
      const row = [
        volume,
        ...libs.map((lib) => {
          const heap = values[lib]
          return typeof heap === 'number' ? `${(heap / Number(volume) / 1024).toFixed(2)} KB` : '—'
        })
      ]
      console.log(row.map((value) => value.padEnd(20)).join(''))
    }
  }
  if (bench.bundleSize !== undefined) {
    console.log('\n=== bundleSize (bytes) ===')
    for (const [lib, size] of Object.entries(bench.bundleSize)) {
      console.log(`${lib.padEnd(20)} raw=${size.raw} gzip=${size.gzip}`)
    }
  }
}

async function main() {
  const volumes = parseVolumes()
  console.log(`starting benchmark: volumes=${volumes.join(',')} headless=${headless ? 'yes' : 'no'}`)

  const vite = execFile(path.join(packageRoot, 'node_modules', '.bin', 'vite'), ['--port', '5199'], { cwd: packageRoot }, (error) => {
    if (error !== null && error.code !== null && error.code !== 'ABORT_ERR' && !error.killed) {
      console.error(`vite exited: ${error.message}`)
    }
  })
  vite.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`))

  try {
    await waitForServer(5199)
    const browser = await chromium.launch({
      headless,
      args: ['--enable-precise-memory-info', '--js-flags=--expose-gc']
    })
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
      page.on('pageerror', (error) => console.error(`[pageerror] ${error.message}`))
      await page.goto('http://localhost:5199/')
      await page.waitForFunction(() => window.__BENCH_READY__ === true, undefined, { timeout: 30000 })
      const bench = await page.evaluate((selectedVolumes) => {
        return window.__runBenchmark__({ volumes: selectedVolumes })
      }, volumes)
      const bundleSize = await runBundleSize()
      if (bundleSize !== undefined) {
        bench.bundleSize = bundleSize
      }
      await mkdir(resultsDir, { recursive: true })
      // UTC ISO stamp (matches meta.date, millisecond precision avoids collisions)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = path.join(resultsDir, `${stamp}.json`)
      await writeFile(file, `${JSON.stringify(bench, null, 2)}\n`)
      printResults(bench)
      console.log(`\nresults written to ${path.relative(process.cwd(), file)}`)
    } finally {
      await browser.close()
    }
  } finally {
    vite.kill()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
