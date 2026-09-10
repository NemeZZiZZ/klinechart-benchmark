import { version as echartsVersion } from 'echarts'
import { version as getKlinechartsVersion } from 'klinecharts'
import lightweightChartsPkg from 'lightweight-charts/package.json'
import { adapters, adaptersByName } from './adapters'
import { CONTAINER_HEIGHT, CONTAINER_WIDTH } from './constants'
import { generateBars, STEP } from './data'
import { measureDestroy, measureFpsCrosshair, measureFpsPanZoom, measureFullUpdate, measureHeapDelta, measureInitialRender, measureLeakPerCycle, measureMultiChart, measurePrependBars, measureResize, measureTickUpdates, measureVisibleAllFps, SCENARIO_NAMES } from './scenarios'
import type { AdapterName, Bar } from './types'

export interface RunOptions {
  volumes?: number[]
  adapterNames?: AdapterName[]
  fpsDurationMs?: number
  ticks?: number
  /** Emit `__cpu:` console markers around fps windows so a CDP-attached runner can measure CPU per frame. */
  cpuMarkers?: boolean
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

const FULL_UPDATE_REPEATS = 5
const PREPEND_CHUNK = 1000
const PREPEND_REPEATS = 5

// performance.eventLoopUtilization is not exposed in window contexts, so the
// page itself cannot measure CPU per frame. Instead the CLI runner attaches a
// CDP session, reads the cumulative TaskDuration metric at these markers and
// divides the delta by the frame count reported on the end marker.
function cpuMarker(kind: 'start' | 'end', scenario: string, adapter: string, volume: number, enabled: boolean, frames = 0): void {
  if (enabled) {
    console.log(`__cpu:${kind}:${scenario}:${adapter}:${volume}:${frames}`)
  }
}

export async function runBenchmark(options: RunOptions = {}): Promise<BenchResults> {
  const { volumes = DEFAULT_VOLUMES, adapterNames = adapters.map((adapter) => adapter.name), fpsDurationMs = 5000, ticks = 1000, cpuMarkers = false, onProgress = () => {} } = options

  const results: BenchResults['results'] = {}
  for (const name of SCENARIO_NAMES) {
    results[name] = {}
  }

  const chartHost = document.createElement('div')
  chartHost.style.cssText = `position:absolute;left:-9999px;top:0;width:${CONTAINER_WIDTH}px;height:${CONTAINER_HEIGHT}px;`
  document.body.appendChild(chartHost)

  try {
    for (const volume of volumes) {
      const data: Bar[] = generateBars(volume)
      // Independently seeded datasets, one per fullUpdate repeat — replacing
      // data with the identical array would let libraries shortcut on
      // reference equality. Generated once per volume, shared by all adapters.
      const freshSets = Array.from({ length: FULL_UPDATE_REPEATS }, (_, i) => generateBars(volume, { seed: 43 + i }))
      // History older than the main dataset, chunked in by prependBars.
      const olderBars = generateBars(PREPEND_CHUNK * PREPEND_REPEATS, {
        seed: 77,
        baseTimestamp: data[0].timestamp - PREPEND_CHUNK * PREPEND_REPEATS * STEP
      })

      for (const name of adapterNames) {
        const adapter = adaptersByName[name]
        const container = document.createElement('div')
        container.style.width = `${CONTAINER_WIDTH}px`
        container.style.height = `${CONTAINER_HEIGHT}px`
        chartHost.appendChild(container)

        onProgress(`initialRender — ${name} @ ${volume} bars`)
        const initial = await measureInitialRender(adapter, container, data)
        results.initialRender[volume] = {
          ...results.initialRender[volume],
          [name]: initial.sync
        }
        results.timeToSettledInitial[volume] = {
          ...results.timeToSettledInitial[volume],
          [name]: initial.settled
        }

        onProgress(`fullUpdate — ${name} @ ${volume} bars`)
        const handle = adapter.create(container, data)
        await new Promise((resolve) => setTimeout(resolve, 200))
        const update = await measureFullUpdate(handle, freshSets)
        results.fullUpdate[volume] = {
          ...results.fullUpdate[volume],
          [name]: update.sync
        }
        results.timeToSettledUpdate[volume] = {
          ...results.timeToSettledUpdate[volume],
          [name]: update.settled
        }
        // Return to the primary dataset so tick updates mutate the last bar
        // the chart actually shows.
        handle.applyData(data)
        await new Promise((resolve) => setTimeout(resolve, 200))

        onProgress(`tickUpdates — ${name} @ ${volume} bars`)
        results.tickUpdates[volume] = {
          ...results.tickUpdates[volume],
          [name]: await measureTickUpdates(handle, data, ticks)
        }

        onProgress(`fpsPanZoom — ${name} @ ${volume} bars`)
        cpuMarker('start', 'cpuPanZoom', name, volume, cpuMarkers)
        const panZoom = await measureFpsPanZoom(container, fpsDurationMs)
        cpuMarker('end', 'cpuPanZoom', name, volume, cpuMarkers, panZoom.frames)
        results.fpsPanZoom[volume] = { ...results.fpsPanZoom[volume], [name]: panZoom.fps }
        results.frameP99PanZoom[volume] = { ...results.frameP99PanZoom[volume], [name]: panZoom.p99 }
        results.jankPanZoom[volume] = { ...results.jankPanZoom[volume], [name]: panZoom.jank }

        onProgress(`fpsCrosshair — ${name} @ ${volume} bars`)
        cpuMarker('start', 'cpuCrosshair', name, volume, cpuMarkers)
        const crosshair = await measureFpsCrosshair(container, fpsDurationMs)
        cpuMarker('end', 'cpuCrosshair', name, volume, cpuMarkers, crosshair.frames)
        results.fpsCrosshair[volume] = { ...results.fpsCrosshair[volume], [name]: crosshair.fps }
        results.frameP99Crosshair[volume] = { ...results.frameP99Crosshair[volume], [name]: crosshair.p99 }
        results.jankCrosshair[volume] = { ...results.jankCrosshair[volume], [name]: crosshair.jank }

        onProgress(`prependBars — ${name} @ ${volume} bars`)
        results.prependBars[volume] = {
          ...results.prependBars[volume],
          [name]: await measurePrependBars(handle, olderBars, PREPEND_CHUNK, PREPEND_REPEATS)
        }

        onProgress(`visibleAllFps — ${name} @ ${volume} bars`)
        handle.setVisibleAll()
        await new Promise((resolve) => setTimeout(resolve, 200))
        results.visibleAllFps[volume] = {
          ...results.visibleAllFps[volume],
          [name]: await measureVisibleAllFps(container, fpsDurationMs)
        }

        onProgress(`resize — ${name} @ ${volume} bars`)
        results.resize[volume] = {
          ...results.resize[volume],
          [name]: await measureResize(handle)
        }
        container.style.width = `${CONTAINER_WIDTH}px`
        container.style.height = `${CONTAINER_HEIGHT}px`
        handle.resize(CONTAINER_WIDTH, CONTAINER_HEIGHT)

        onProgress(`destroyMs — ${name} @ ${volume} bars`)
        results.destroyMs[volume] = {
          ...results.destroyMs[volume],
          [name]: await measureDestroy(adapter, container, data)
        }
        handle.destroy()

        onProgress(`heapDelta — ${name} @ ${volume} bars`)
        results.heapDelta[volume] = {
          ...results.heapDelta[volume],
          [name]: await measureHeapDelta(adapter, container, data)
        }

        onProgress(`leakPerCycle — ${name} @ ${volume} bars`)
        results.leakPerCycle[volume] = {
          ...results.leakPerCycle[volume],
          [name]: await measureLeakPerCycle(adapter, container, data)
        }

        onProgress(`multiChart — ${name} @ ${volume} bars`)
        const multi = await measureMultiChart(adapter, data, 4, fpsDurationMs)
        if (multi.heap !== null) {
          results.multiChartHeap[volume] = { ...results.multiChartHeap[volume], [name]: multi.heap }
        }
        results.multiChartFps[volume] = { ...results.multiChartFps[volume], [name]: multi.fps }

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
      platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
      versions: getVersions()
    },
    results
  }
}
