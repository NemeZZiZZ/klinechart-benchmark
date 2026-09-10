import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { CONTAINER_HEIGHT, CONTAINER_WIDTH, VISIBLE_BAR_COUNT } from '../constants'
import type { Bar, ChartAdapter } from '../types'

interface LightweightBar {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
}

function toLightweightBars(bars: Bar[]): LightweightBar[] {
  return bars.map((bar) => ({
    time: (bar.timestamp / 1000) as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close
  }))
}

export const lightweightChartsAdapter: ChartAdapter = {
  name: 'lightweight-charts',
  create(container, data) {
    const chart: IChartApi = createChart(container, {
      width: CONTAINER_WIDTH,
      height: CONTAINER_HEIGHT,
      autoSize: false
    })
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      priceLineVisible: false,
      lastValueVisible: false
    })
    let current = data
    series.setData(toLightweightBars(current))
    chart.timeScale().setVisibleLogicalRange({
      from: current.length - VISIBLE_BAR_COUNT,
      to: current.length - 1
    })

    return {
      applyData(next) {
        current = next
        series.setData(toLightweightBars(next))
        chart.timeScale().setVisibleLogicalRange({
          from: next.length - VISIBLE_BAR_COUNT,
          to: next.length - 1
        })
      },
      updateLast(bar) {
        series.update({
          time: (bar.timestamp / 1000) as UTCTimestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close
        })
      },
      // No incremental prepend API: series.update() only touches the last bar,
      // so older history goes in through a full setData, view pinned to the tail.
      prependBars(bars) {
        current = [...bars, ...current]
        series.setData(toLightweightBars(current))
        chart.timeScale().setVisibleLogicalRange({
          from: current.length - VISIBLE_BAR_COUNT,
          to: current.length - 1
        })
      },
      setVisibleAll() {
        chart.timeScale().fitContent()
      },
      resize(width, height) {
        chart.applyOptions({ width, height })
      },
      destroy() {
        chart.remove()
      }
    }
  }
}
