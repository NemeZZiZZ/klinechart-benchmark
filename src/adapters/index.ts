import type { AdapterName, ChartAdapter } from '../types'
import { echartsAdapter } from './echarts'
import { klinechartsAdapter } from './klinecharts'
import { lightweightChartsAdapter } from './lightweight-charts'

export const adapters: ChartAdapter[] = [klinechartsAdapter, lightweightChartsAdapter, echartsAdapter]

export const adaptersByName: Record<AdapterName, ChartAdapter> = {
  klinecharts: klinechartsAdapter,
  'lightweight-charts': lightweightChartsAdapter,
  echarts: echartsAdapter
}

export { echartsAdapter, klinechartsAdapter, lightweightChartsAdapter }
