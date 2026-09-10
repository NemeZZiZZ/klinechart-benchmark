import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const distDir = path.join(packageRoot, 'size-dist')

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

function build() {
  return new Promise((resolve, reject) => {
    execFile(path.join(packageRoot, 'node_modules', '.bin', 'vite'), ['build', '--config', 'vite.size.config.ts'], { cwd: packageRoot }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`vite build failed: ${stderr || stdout}`))
        return
      }
      resolve()
    })
  })
}

async function collect() {
  const files = await readdir(path.join(distDir, 'assets'), { withFileTypes: true })
  const entries = {}
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue
    }
    const match = entry.name.match(/^(klinecharts|lightweight-charts|echarts)-[A-Za-z0-9_-]+\.js$/)
    if (match === null) {
      continue
    }
    const lib = match[1]
    const file = path.join(distDir, 'assets', entry.name)
    const info = await stat(file)
    const content = await readFile(file)
    entries[lib] = {
      raw: info.size,
      gzip: gzipSync(content, { level: 9 }).length
    }
  }
  return entries
}

async function main() {
  await build()
  const entries = await collect()
  const libs = ['klinecharts', 'lightweight-charts', 'echarts']
  for (const lib of libs) {
    if (entries[lib] === undefined) {
      throw new Error(`no bundle found for ${lib}`)
    }
  }
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(entries)}\n`)
    return
  }
  console.log('bundle sizes (bytes):')
  for (const lib of libs) {
    const size = entries[lib]
    console.log(`  ${lib.padEnd(20)} raw=${String(size.raw).padStart(9)}  gzip=${String(size.gzip).padStart(8)}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
