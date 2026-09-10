import { CONTAINER_HEIGHT, CONTAINER_WIDTH } from './constants'
import { mulberry32 } from './data'
import type { Bar, ChartAdapter, ChartHandle } from './types'

export const SCENARIO_NAMES = [
  'initialRender',
  'timeToSettledInitial',
  'fullUpdate',
  'timeToSettledUpdate',
  'tickUpdates',
  'prependBars',
  'fpsPanZoom',
  'frameP99PanZoom',
  'jankPanZoom',
  'cpuPanZoom',
  'fpsCrosshair',
  'frameP99Crosshair',
  'jankCrosshair',
  'cpuCrosshair',
  'visibleAllFps',
  'resize',
  'destroyMs',
  'heapDelta',
  'leakPerCycle',
  'multiChartHeap',
  'multiChartFps'
] as const

export type ScenarioName = (typeof SCENARIO_NAMES)[number]

function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function settledFrame(): Promise<void> {
  await raf()
  await raf()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

export interface Timings {
  sync: number
  settled: number
}

export interface FpsStats {
  fps: number
  p99: number
  jank: number
  frames: number
}

export interface MultiChartStats {
  heap: number | null
  fps: number
}

export async function measureInitialRender(adapter: ChartAdapter, container: HTMLElement, data: Bar[], repeats = 5): Promise<Timings> {
  const syncTimes: number[] = []
  const settledTimes: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    await settledFrame()
    const start = performance.now()
    const handle = adapter.create(container, data)
    syncTimes.push(performance.now() - start)
    await settledFrame()
    settledTimes.push(performance.now() - start)
    handle.destroy()
  }
  return { sync: median(syncTimes), settled: median(settledTimes) }
}

export async function measureFullUpdate(handle: ChartHandle, datasets: Bar[][], repeats = 5): Promise<Timings> {
  const syncTimes: number[] = []
  const settledTimes: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    await settledFrame()
    const dataset = datasets[i % datasets.length]
    const start = performance.now()
    handle.applyData(dataset)
    syncTimes.push(performance.now() - start)
    await settledFrame()
    settledTimes.push(performance.now() - start)
  }
  return { sync: median(syncTimes), settled: median(settledTimes) }
}

export async function measureTickUpdates(handle: ChartHandle, data: Bar[], ticks = 1000): Promise<number> {
  const last = data[data.length - 1]
  const random = mulberry32(7)
  let price = last.close
  let high = last.high
  let low = last.low
  let volume = last.volume
  const start = performance.now()
  for (let i = 0; i < ticks; i += 1) {
    price = Math.max(0.01, price + (random() - 0.5) * 2)
    high = Math.max(high, price)
    low = Math.min(low, price)
    volume += Math.floor(random() * 100)
    handle.updateLast({
      timestamp: last.timestamp,
      open: last.open,
      high,
      low,
      close: price,
      volume
    })
  }
  const elapsed = performance.now() - start
  await settledFrame()
  return elapsed / ticks
}

// Simulates lazy history loading: older bars arrive in chunks while the chart
// stays anchored to the newest bars.
export async function measurePrependBars(handle: ChartHandle, older: Bar[], chunkSize = 1000, repeats = 5): Promise<number> {
  const times: number[] = []
  // Chunks are fed newest-first: every prepend places its chunk before all
  // existing bars, so the oldest chunk must land last to keep time ascending.
  for (let i = 0; i < repeats; i += 1) {
    await settledFrame()
    const end = older.length - i * chunkSize
    const chunk = older.slice(Math.max(0, end - chunkSize), end)
    if (chunk.length === 0) {
      break
    }
    const start = performance.now()
    handle.prependBars(chunk)
    times.push(performance.now() - start)
    await settledFrame()
  }
  return median(times)
}

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number }
}

// A frame counts as janky when it lasts at least twice the median frame time
// and at least one missed 60 Hz frame (16.7 ms), so the counter adapts to the
// display refresh rate instead of assuming one.
function countJank(frameTimes: number[]): number {
  if (frameTimes.length === 0) {
    return 0
  }
  const threshold = Math.max(median(frameTimes) * 2, 1000 / 60)
  return frameTimes.filter((delta) => delta >= threshold).length
}

// Synthetic events bypass hit-testing, so they must be dispatched on the same
// element a real pointer would hit: the topmost canvas covering the point.
// lightweight-charts attaches its mouse listeners to the top overlay canvas —
// dispatching on the first (main) canvas never reaches them, because events
// propagate to ancestors, not to sibling canvases. klinecharts listens on a
// widget div (any child canvas works via bubbling), ECharts on its root div.
function getCanvasTarget(container: HTMLElement): HTMLElement {
  const canvases = [...container.querySelectorAll('canvas')]
  if (canvases.length === 0) {
    return container
  }
  const rect = container.getBoundingClientRect()
  const pointX = rect.left + rect.width / 2
  const pointY = rect.top + rect.height / 2
  const covering = canvases.filter((canvas) => {
    const canvasRect = canvas.getBoundingClientRect()
    return pointX >= canvasRect.left && pointX <= canvasRect.right && pointY >= canvasRect.top && pointY <= canvasRect.bottom
  })
  // Last in DOM order among the covering canvases is the topmost one.
  return covering.length > 0 ? covering[covering.length - 1] : canvases[canvases.length - 1]
}

interface PointerInit {
  clientX: number
  clientY: number
  buttons?: number
}

// klinecharts and lightweight-charts listen to mouse events only, ECharts (zrender)
// mounts pointer listeners only — dispatch both so every library gets the gesture.
// No double handling: each library ignores the event family it does not listen to.
function dispatchPointerAndMouse(target: HTMLElement, kind: 'down' | 'move' | 'up', init: PointerInit): void {
  const { clientX, clientY, buttons = 0 } = init
  target.dispatchEvent(
    new PointerEvent(`pointer${kind}`, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons
    })
  )
  target.dispatchEvent(
    new MouseEvent(`mouse${kind}`, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons
    })
  )
}

async function drivePointerInput(container: HTMLElement, durationMs: number, mode: 'panZoom' | 'crosshair' | 'pan'): Promise<FpsStats> {
  const target = getCanvasTarget(container)
  const rect = target.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const panning = mode !== 'crosshair'
  const zooming = mode === 'panZoom'

  if (panning) {
    dispatchPointerAndMouse(target, 'down', { clientX: centerX, clientY: centerY, buttons: 1 })
  }

  const start = performance.now()
  let frames = 0
  let lastWheel = start
  let wheelDirection = 1
  let previousFrame = 0
  const frameTimes: number[] = []

  await new Promise<void>((resolve) => {
    function frame(now: number) {
      const elapsed = now - start
      if (elapsed >= durationMs) {
        resolve()
        return
      }
      if (previousFrame > 0) {
        frameTimes.push(now - previousFrame)
      }
      previousFrame = now
      frames += 1
      const phase = (elapsed / durationMs) * Math.PI * 12
      dispatchPointerAndMouse(target, 'move', {
        clientX: centerX + Math.sin(phase) * (rect.width / 4),
        clientY: panning ? centerY : centerY + Math.cos(phase) * (rect.height / 4),
        buttons: panning ? 1 : 0
      })
      if (zooming && now - lastWheel >= 500) {
        lastWheel = now
        wheelDirection *= -1
        target.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY,
            deltaY: wheelDirection * 100,
            deltaMode: 0
          })
        )
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  if (panning) {
    dispatchPointerAndMouse(target, 'up', { clientX: centerX, clientY: centerY })
  }

  const elapsed = performance.now() - start
  return {
    fps: (frames * 1000) / elapsed,
    p99: percentile(frameTimes, 0.99),
    jank: countJank(frameTimes),
    frames
  }
}

export function measureFpsPanZoom(container: HTMLElement, durationMs = 5000): Promise<FpsStats> {
  return drivePointerInput(container, durationMs, 'panZoom')
}

export function measureFpsCrosshair(container: HTMLElement, durationMs = 5000): Promise<FpsStats> {
  return drivePointerInput(container, durationMs, 'crosshair')
}

export async function measureVisibleAllFps(container: HTMLElement, durationMs = 5000): Promise<number> {
  const stats = await drivePointerInput(container, durationMs, 'pan')
  return stats.fps
}

export async function measureResize(handle: ChartHandle, repeats = 5): Promise<number> {
  const sizes: Array<[number, number]> = [
    [640, 360],
    [800, 400]
  ]
  const times: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    await settledFrame()
    const [width, height] = sizes[i % sizes.length]
    const start = performance.now()
    handle.resize(width, height)
    times.push(performance.now() - start)
    await settledFrame()
  }
  return median(times)
}

// Each iteration gets its own fresh container: reusing the shared one would
// make klinecharts/ECharts `init` return the still-live instance instead of
// creating a new chart, silently disposing someone else's chart.
export async function measureDestroy(adapter: ChartAdapter, container: HTMLElement, data: Bar[], repeats = 5): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    const fresh = document.createElement('div')
    fresh.style.cssText = container.style.cssText
    container.appendChild(fresh)
    const handle = adapter.create(fresh, data)
    await settledFrame()
    const start = performance.now()
    handle.destroy()
    times.push(performance.now() - start)
    await settledFrame()
    fresh.remove()
  }
  return median(times)
}

export async function measureHeapDelta(adapter: ChartAdapter, container: HTMLElement, data: Bar[]): Promise<number | null> {
  const memoryPerformance = performance as MemoryPerformance
  if (memoryPerformance.memory === undefined) {
    return null
  }
  const readHeap = () => memoryPerformance.memory?.usedJSHeapSize ?? 0
  await settledFrame()
  await sleep(100)
  const gcWindow = window as { gc?: () => void }
  gcWindow.gc?.()
  await sleep(100)
  const before = readHeap()
  const handle = adapter.create(container, data)
  await settledFrame()
  await sleep(500)
  gcWindow.gc?.()
  await sleep(100)
  const after = readHeap()
  handle.destroy()
  return after - before
}

// Retained heap per create→destroy cycle. One warm-up cycle absorbs one-off
// module initialization, so a healthy library should converge near zero.
export async function measureLeakPerCycle(adapter: ChartAdapter, container: HTMLElement, data: Bar[], cycles = 10): Promise<number | null> {
  const memoryPerformance = performance as MemoryPerformance
  if (memoryPerformance.memory === undefined) {
    return null
  }
  const readHeap = () => memoryPerformance.memory?.usedJSHeapSize ?? 0
  const gcWindow = window as { gc?: () => void }
  const gc = async () => {
    await sleep(100)
    gcWindow.gc?.()
    await sleep(100)
  }

  const warmup = adapter.create(container, data)
  await settledFrame()
  warmup.destroy()
  await settledFrame()

  await gc()
  const before = readHeap()
  for (let i = 0; i < cycles; i += 1) {
    const handle = adapter.create(container, data)
    await settledFrame()
    handle.destroy()
    await settledFrame()
  }
  await gc()
  const after = readHeap()
  return (after - before) / cycles
}

// Four live charts at once: total retained heap and FPS while panning the
// first one with the other three still rendering in the background.
export async function measureMultiChart(adapter: ChartAdapter, data: Bar[], chartCount = 4, durationMs = 5000): Promise<MultiChartStats> {
  const memoryPerformance = performance as MemoryPerformance
  const hasMemory = memoryPerformance.memory !== undefined
  const readHeap = () => memoryPerformance.memory?.usedJSHeapSize ?? 0
  const gcWindow = window as { gc?: () => void }

  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:0;'
  document.body.appendChild(host)
  const containers: HTMLElement[] = []
  const handles: ChartHandle[] = []
  try {
    for (let i = 0; i < chartCount; i += 1) {
      const element = document.createElement('div')
      element.style.width = `${CONTAINER_WIDTH}px`
      element.style.height = `${CONTAINER_HEIGHT}px`
      host.appendChild(element)
      containers.push(element)
    }

    let before = 0
    if (hasMemory) {
      await settledFrame()
      await sleep(100)
      gcWindow.gc?.()
      await sleep(100)
      before = readHeap()
    }

    for (const element of containers) {
      handles.push(adapter.create(element, data))
    }
    await settledFrame()
    await sleep(500)

    let heap: number | null = null
    if (hasMemory) {
      gcWindow.gc?.()
      await sleep(100)
      heap = readHeap() - before
    }

    const stats = await drivePointerInput(containers[0], durationMs, 'panZoom')
    return { heap, fps: stats.fps }
  } finally {
    for (const handle of handles) {
      handle.destroy()
    }
    host.remove()
  }
}
