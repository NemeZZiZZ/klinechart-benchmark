import { mulberry32 } from './data'
import type { Bar, ChartAdapter, ChartHandle } from './types'

export const SCENARIO_NAMES = ['initialRender', 'fullUpdate', 'tickUpdates', 'fpsPanZoom', 'heapDelta'] as const

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
    await raf()
    times.push(performance.now() - start)
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
    await raf()
    times.push(performance.now() - start)
  }
  return median(times)
}

export async function measureTickUpdates(handle: ChartHandle, data: Bar[], ticks = 1000): Promise<number> {
  const last = data[data.length - 1]
  const random = mulberry32(7)
  let price = last.close
  const start = performance.now()
  for (let i = 0; i < ticks; i += 1) {
    price = Math.max(0.01, price + (random() - 0.5) * 2)
    const open = i === 0 ? last.open : price - (random() - 0.5)
    handle.updateLast({
      timestamp: last.timestamp,
      open,
      high: Math.max(open, price) + random() * 0.5,
      low: Math.min(open, price) - random() * 0.5,
      close: price,
      volume: last.volume + Math.floor(random() * 100)
    })
  }
  await settledFrame()
  return (performance.now() - start) / ticks
}

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number }
}

function getCanvasTarget(container: HTMLElement): HTMLElement {
  return container.querySelector('canvas') ?? container
}

export async function measureFpsPanZoom(container: HTMLElement, durationMs = 5000): Promise<number> {
  const target = getCanvasTarget(container)
  const rect = target.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: 1
    })
  )

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
      target.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: centerX + Math.sin(phase) * (rect.width / 4),
          clientY: centerY,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          buttons: 1
        })
      )
      if (now - lastWheel >= 500) {
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

  target.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: centerX,
      clientY: centerY,
      pointerId: 1,
      isPrimary: true,
      button: 0
    })
  )

  const elapsed = performance.now() - start
  return (frames * 1000) / elapsed
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
  const after = readHeap()
  handle.destroy()
  return after - before
}
