import { version as getKlinechartsVersion } from 'klinecharts'
import lightweightChartsPkg from 'lightweight-charts/package.json'
import { version as echartsVersion } from 'echarts'
import { adapters, adaptersByName } from './adapters'
import { CONTAINER_HEIGHT, CONTAINER_WIDTH } from './constants'
import { generateBars } from './data'
import { measureFpsPanZoom, measureFullUpdate, measureHeapDelta, measureInitialRender, measureTickUpdates } from './scenarios'
import type { AdapterName, Bar } from './types'

export interface RunOptions {
  volumes?: number[]
  adapterNames?: AdapterName[]
  fpsDurationMs?: number
  ticks?: number
  onProgress?: (message: string) => void
}

export interface BundleSize {
  raw: number
  gzip: number
}

export interface BenchResults {
  meta: {
    date: string
    userAgent: string
    platform: string
    versions: Record<string, string>
  }
  results: Record<string, Record<string, Partial<Record<AdapterName, number>>>>
  bundleSize?: Record<AdapterName, BundleSize>
}

export function getVersions(): Record<string, string> {
  return {
    klinecharts: getKlinechartsVersion(),
    'lightweight-charts': lightweightChartsPkg.version,
    echarts: echartsVersion
  }
}

export const DEFAULT_VOLUMES = [5000, 10000, 20000, 50000, 100000, 200000]

export async function runBenchmark(options: RunOptions = {}): Promise<BenchResults> {
  const { volumes = DEFAULT_VOLUMES, adapterNames = adapters.map((adapter) => adapter.name), fpsDurationMs = 5000, ticks = 1000, onProgress = () => {} } = options

  const results: BenchResults['results'] = {}
  for (const name of ['initialRender', 'fullUpdate', 'tickUpdates', 'fpsPanZoom', 'heapDelta']) {
    results[name] = {}
  }

  const chartHost = document.createElement('div')
  chartHost.style.cssText = `position:absolute;left:-9999px;top:0;width:${CONTAINER_WIDTH}px;height:${CONTAINER_HEIGHT}px;`
  document.body.appendChild(chartHost)

  try {
    for (const volume of volumes) {
      const data: Bar[] = generateBars(volume)
      for (const name of adapterNames) {
        const adapter = adaptersByName[name]
        const container = document.createElement('div')
        container.style.width = `${CONTAINER_WIDTH}px`
        container.style.height = `${CONTAINER_HEIGHT}px`
        chartHost.appendChild(container)

        onProgress(`initialRender — ${name} @ ${volume} bars`)
        results.initialRender[volume] = {
          ...results.initialRender[volume],
          [name]: await measureInitialRender(adapter, container, data)
        }

        onProgress(`fullUpdate — ${name} @ ${volume} bars`)
        const handle = adapter.create(container, data)
        await new Promise((resolve) => setTimeout(resolve, 200))
        results.fullUpdate[volume] = {
          ...results.fullUpdate[volume],
          [name]: await measureFullUpdate(handle, data)
        }

        onProgress(`tickUpdates — ${name} @ ${volume} bars`)
        results.tickUpdates[volume] = {
          ...results.tickUpdates[volume],
          [name]: await measureTickUpdates(handle, data, ticks)
        }

        onProgress(`fpsPanZoom — ${name} @ ${volume} bars`)
        results.fpsPanZoom[volume] = {
          ...results.fpsPanZoom[volume],
          [name]: await measureFpsPanZoom(container, fpsDurationMs)
        }
        handle.destroy()

        onProgress(`heapDelta — ${name} @ ${volume} bars`)
        results.heapDelta[volume] = {
          ...results.heapDelta[volume],
          [name]: await measureHeapDelta(adapter, container, data)
        }

        container.remove()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  } finally {
    chartHost.remove()
  }

  return {
    meta: {
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      versions: getVersions()
    },
    results
  }
}
