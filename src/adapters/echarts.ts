import * as echarts from 'echarts'
import { CONTAINER_HEIGHT, CONTAINER_WIDTH, VISIBLE_BAR_COUNT } from '../constants'
import type { Bar, ChartAdapter } from '../types'

type CandleDatum = [number, number, number, number]

function toCandleData(bars: Bar[]): CandleDatum[] {
  return bars.map((bar) => [bar.open, bar.close, bar.low, bar.high])
}

function buildIndices(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(index))
}

export const echartsAdapter: ChartAdapter = {
  name: 'echarts',
  create(container, data) {
    const chart = echarts.init(container, null, {
      renderer: 'canvas',
      width: CONTAINER_WIDTH,
      height: CONTAINER_HEIGHT
    })
    let candleData = toCandleData(data)
    let indices = buildIndices(data.length)
    chart.setOption(buildOption(indices, candleData))

    return {
      applyData(next) {
        candleData = toCandleData(next)
        indices = buildIndices(next.length)
        chart.setOption(buildOption(indices, candleData), { replaceMerge: ['xAxis', 'series'] })
      },
      updateLast(bar) {
        const lastIndex = candleData.length - 1
        const next = candleData.slice()
        next[lastIndex] = [bar.open, bar.close, bar.low, bar.high]
        candleData = next
        chart.setOption({ series: [{ data: next }] })
      },
      prependBars(bars) {
        candleData = [...toCandleData(bars), ...candleData]
        indices = buildIndices(candleData.length)
        chart.setOption(buildOption(indices, candleData), { replaceMerge: ['xAxis', 'series'] })
      },
      setVisibleAll() {
        chart.setOption({ dataZoom: [{ type: 'inside', startValue: 0, endValue: candleData.length - 1 }] })
      },
      resize(width, height) {
        chart.resize({ width, height })
      },
      destroy() {
        chart.dispose()
      }
    }

    function buildOption(indices: string[], candleData: CandleDatum[]): echarts.EChartsOption {
      return {
        animation: false,
        // Cross-shaped axis pointer so synthetic hover does the same kind of
        // crosshair tracking the other libraries do in fpsCrosshair.
        tooltip: {
          trigger: 'axis',
          showContent: false,
          axisPointer: { type: 'cross' }
        },
        grid: { left: 60, right: 20, top: 20, bottom: 40 },
        xAxis: {
          type: 'category',
          data: indices,
          boundaryGap: true,
          axisLabel: { show: false },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLabel: { show: false },
          splitLine: { show: false }
        },
        dataZoom: [
          {
            type: 'inside',
            startValue: Math.max(0, indices.length - VISIBLE_BAR_COUNT),
            endValue: Math.max(0, indices.length - 1)
          }
        ],
        series: [
          {
            type: 'candlestick',
            data: candleData,
            itemStyle: { color: '#ef232a', color0: '#14b143', borderColor: '#ef232a', borderColor0: '#14b143' }
          }
        ]
      }
    }
  }
}
