import { dispose, init, type KLineData } from 'klinecharts'
import { VISIBLE_BAR_COUNT } from '../constants'
import type { Bar, ChartAdapter, ChartHandle } from '../types'

type RealtimeCallback = (data: KLineData) => void

export const klinechartsAdapter: ChartAdapter = {
  name: 'klinecharts',
  create(container, data) {
    let currentData: Bar[] = data
    let realtimeCallback: RealtimeCallback | null = null

    const chart = init(container)
    if (chart === null) {
      throw new Error('klinecharts init failed')
    }
    chart.setSymbol({ ticker: 'BENCHMARK' })
    chart.setPeriod({ span: 1, type: 'minute' })
    chart.setDataLoader({
      getBars: ({ callback }) => {
        callback(currentData as KLineData[], { forward: false, backward: false })
      },
      subscribeBar: ({ callback }) => {
        realtimeCallback = callback
      },
      unsubscribeBar: () => {
        realtimeCallback = null
      }
    })
    chart.setOffsetRightDistance(0)
    chart.setBarSpace(container.clientWidth / VISIBLE_BAR_COUNT)
    chart.scrollToRealTime()

    const handle: ChartHandle = {
      applyData(next) {
        currentData = next
        chart.resetData()
        chart.setBarSpace(container.clientWidth / VISIBLE_BAR_COUNT)
        chart.scrollToRealTime()
      },
      updateLast(bar) {
        realtimeCallback?.(bar as KLineData)
      },
      // klinecharts has no incremental prepend API in v10 — data flows through
      // the loader, so prepending history means replacing the dataset.
      prependBars(bars) {
        currentData = [...bars, ...currentData]
        chart.resetData()
        chart.setBarSpace(container.clientWidth / VISIBLE_BAR_COUNT)
        chart.scrollToRealTime()
      },
      setVisibleAll() {
        // barSpaceLimit.min is 1px, so beyond ~800 bars this is the widest
        // possible zoom, not the whole dataset.
        chart.setBarSpace(1)
        chart.scrollToDataIndex(0)
      },
      resize(width, height) {
        container.style.width = `${width}px`
        container.style.height = `${height}px`
        chart.resize()
      },
      destroy() {
        realtimeCallback = null
        dispose(chart)
      }
    }
    return handle
  }
}
