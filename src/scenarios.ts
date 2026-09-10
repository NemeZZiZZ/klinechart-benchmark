import { mulberry32 } from './data'
import type { Bar, ChartAdapter, ChartHandle } from './types'

export const SCENARIO_NAMES = ['initialRender', 'fullUpdate', 'tickUpdates', 'fpsPanZoom', 'fpsCrosshair', 'resize', 'destroyMs', 'heapDelta'] as const

export type ScenarioName = (typeof SCENARIO_NAMES)[number]

function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function settledFrame(): Promise<void> {
  await raf()
  await raf()
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export async function measureInitialRender(adapter: ChartAdapter, container: HTMLElement, data: Bar[], repeats = 5): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    await settledFrame()
    const start = performance.now()
    const handle = adapter.create(container, data)
    times.push(performance.now() - start)
    await settledFrame()
    handle.destroy()
  }
  return median(times)
}

export async function measureFullUpdate(handle: ChartHandle, data: Bar[], repeats = 5): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    await settledFrame()
    const start = performance.now()
    handle.applyData(data)
    times.push(performance.now() - start)
    await settledFrame()
  }
  return median(times)
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

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number }
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

async function drivePointerInput(container: HTMLElement, durationMs: number, mode: 'panZoom' | 'crosshair'): Promise<number> {
  const target = getCanvasTarget(container)
  const rect = target.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const panning = mode === 'panZoom'

  if (panning) {
    dispatchPointerAndMouse(target, 'down', { clientX: centerX, clientY: centerY, buttons: 1 })
  }

  const start = performance.now()
  let frames = 0
  let lastWheel = start
  let wheelDirection = 1

  await new Promise<void>((resolve) => {
    function frame(now: number) {
      const elapsed = now - start
      if (elapsed >= durationMs) {
        resolve()
        return
      }
      frames += 1
      const phase = (elapsed / durationMs) * Math.PI * 12
      dispatchPointerAndMouse(target, 'move', {
        clientX: centerX + Math.sin(phase) * (rect.width / 4),
        clientY: panning ? centerY : centerY + Math.cos(phase) * (rect.height / 4),
        buttons: panning ? 1 : 0
      })
      if (panning && now - lastWheel >= 500) {
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
  return (frames * 1000) / elapsed
}

export function measureFpsPanZoom(container: HTMLElement, durationMs = 5000): Promise<number> {
  return drivePointerInput(container, durationMs, 'panZoom')
}

export function measureFpsCrosshair(container: HTMLElement, durationMs = 5000): Promise<number> {
  return drivePointerInput(container, durationMs, 'crosshair')
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

export async function measureDestroy(adapter: ChartAdapter, container: HTMLElement, data: Bar[], repeats = 5): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < repeats; i += 1) {
    const handle = adapter.create(container, data)
    await settledFrame()
    const start = performance.now()
    handle.destroy()
    times.push(performance.now() - start)
    await settledFrame()
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
  await new Promise((resolve) => setTimeout(resolve, 100))
  const gcWindow = window as { gc?: () => void }
  gcWindow.gc?.()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const before = readHeap()
  const handle = adapter.create(container, data)
  await settledFrame()
  await new Promise((resolve) => setTimeout(resolve, 500))
  gcWindow.gc?.()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const after = readHeap()
  handle.destroy()
  return after - before
}
