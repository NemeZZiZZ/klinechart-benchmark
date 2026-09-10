# KLineChart Benchmark

**Live harness: <https://nemezzizz.github.io/klinechart-benchmark/>** — run the benchmark in your own browser.

Reproducible performance comparison of three charting libraries rendering the same OHLCV data:

- [klinecharts](https://github.com/klinecharts/KLineChart)
- [lightweight-charts](https://github.com/tradingview/lightweight-charts)
- [Apache ECharts](https://github.com/apache/echarts)

## Metrics

| Scenario | What it measures | Unit |
| --- | --- | --- |
| `initialRender` | synchronous execution of init + full data load (canvas draw calls run synchronously on the CPU; frame presentation is compositor work identical for all libraries), median of 5 | ms |
| `fullUpdate` | synchronous execution of replacing the whole dataset with an independently seeded one (seed 43) on a live chart, median of 5 | ms |
| `tickUpdates` | synchronous time of 1000 sequential updates of the last (still forming) candle: open fixed, high/low only expand, close random-walks, volume accumulates | ms per tick |
| `fpsPanZoom` | average FPS over 5s of synthetic drag pan (mouse+pointer event pairs) + wheel zoom every 500ms | fps |
| `fpsCrosshair` | average FPS over 5s of synthetic hover (crosshair tracking, no buttons pressed) | fps |
| `resize` | synchronous execution of a container resize (800×400 ↔ 640×360, alternating), median of 5 | ms |
| `destroyMs` | synchronous execution of chart disposal after a settled render, median of 5 | ms |
| `heapDelta` | retained JS heap growth after loading a chart with N bars; forced GC before both snapshots when available (Chromium only) | MB |
| `heapPerBar` | derived: `heapDelta ÷ volume`, normalized memory cost per candle | KB |
| `bundleSize` | production Vite build of a minimal one-chart page (modular imports only — for ECharts: `echarts/core` + candlestick chart, grid/dataZoom components, canvas renderer), raw + gzip | bytes |

## Fairness rules

- Chart container is 800×400 for every library, animations disabled.
- Identical seeded dataset (mulberry32, seed 42) for a given volume; `fullUpdate` replaces it with a second seeded dataset (seed 43) of the same volume.
- Visible window is the last 120 candles in every library.
- ECharts uses the canvas renderer explicitly.
- Pan/zoom/crosshair use the same synthetic input event trajectory for every library. Events are dispatched as mouse+pointer pairs because the libraries listen to different event families: klinecharts and lightweight-charts handle mouse events only, ECharts (zrender) mounts pointer listeners only — each library sees exactly one copy of every gesture. Events target the topmost canvas under the cursor, mirroring real hit-testing (lightweight-charts attaches its mouse handlers to the top overlay canvas; events dispatched on a sibling canvas never reach them).

## Usage

```bash
pnpm install
pnpm exec playwright install chromium

# interactive harness page (manual runs, JSON download)
pnpm dev

# automated run via Playwright (headed by default for realistic FPS numbers)
pnpm run
pnpm run --headless --volumes=5000,10000

# bundle-size measurement only
pnpm size
```

### Measuring local source instead of the npm release

By default the harness pins the published `klinecharts` package so results are reproducible. To benchmark a local checkout, point `KLINE_BENCH_LOCAL` at its source entry:

```bash
KLINE_BENCH_LOCAL=../KLineChart/src/index.ts pnpm dev
KLINE_BENCH_LOCAL=../KLineChart/src/index.ts pnpm run
```

## Environment requirements

- Node.js 22+, pnpm.
- `heapDelta` requires Chromium with `--enable-precise-memory-info`; the Playwright runner passes this automatically (plus `--js-flags=--expose-gc`). The column shows `—` in browsers without `performance.memory`. Without an exposed `gc()` the numbers are noisier and can occasionally go negative when the browser collects garbage mid-measurement.
- For publishable FPS numbers run headed (`pnpm run` without `--headless`) on a quiet machine, no other load, charger plugged in on laptops.

## Results format

Each run writes `results/<timestamp>.json` (UTC ISO timestamp, matching `meta.date`; committed runs serve as reference data):

```json
{
	"meta": {
		"date": "2026-09-10T12:00:00.000Z",
		"userAgent": "...",
		"platform": "...",
		"versions": { "klinecharts": "10.0.3", "lightweight-charts": "5.2.1", "echarts": "6.1.0" }
	},
	"results": {
		"initialRender": { "5000": { "klinecharts": 120, "lightweight-charts": 130, "echarts": 200 } }
	},
	"bundleSize": { "klinecharts": { "raw": 222581, "gzip": 57064 } }
}
```

## Caveats

All libraries are configured similarly, not identically — each has its own feature set and defaults. Numbers compare *this harness's scenario*, not every possible configuration. Run it yourself: `pnpm dev` executes the whole benchmark in your own browser.
