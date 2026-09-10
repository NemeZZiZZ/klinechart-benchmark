import type { Bar } from './types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE_TIMESTAMP = Date.UTC(2020, 0, 1)
export const STEP = 60_000
const BASE_PRICE = 100

export interface GenerateOptions {
  seed?: number
  baseTimestamp?: number
}

export function generateBars(count: number, options: GenerateOptions = {}): Bar[] {
  const { seed = 42, baseTimestamp = BASE_TIMESTAMP } = options
  const random = mulberry32(seed)
  const bars: Bar[] = []
  let close = BASE_PRICE
  for (let i = 0; i < count; i += 1) {
    const timestamp = baseTimestamp + i * STEP
    const open = close
    const drift = (random() - 0.5) * 2
    close = round(Math.max(1, open + drift))
    const spread = random() * 1.5
    const high = round(Math.max(open, close) + spread * random())
    const low = round(Math.max(0.01, Math.min(open, close) - spread * random()))
    const volume = 100 + Math.floor(random() * 9900)
    bars.push({ timestamp, open, high, low, close, volume })
  }
  return bars
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
