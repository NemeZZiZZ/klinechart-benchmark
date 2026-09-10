export interface Bar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type AdapterName = 'klinecharts' | 'lightweight-charts' | 'echarts'

export interface ChartHandle {
  applyData(data: Bar[]): void
  updateLast(bar: Bar): void
  resize(width: number, height: number): void
  destroy(): void
}

export interface ChartAdapter {
  name: AdapterName
  create(container: HTMLElement, data: Bar[]): ChartHandle
}
