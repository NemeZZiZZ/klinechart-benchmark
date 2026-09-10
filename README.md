# KLineChart Benchmark

**Live harness: <https://nemezzizz.github.io/klinechart-benchmark/>** — run the benchmark in your own browser.

Reproducible performance comparison of three charting libraries rendering the same OHLCV data:

- [klinecharts](https://github.com/klinecharts/KLineChart)
- [lightweight-charts](https://github.com/tradingview/lightweight-charts)
- [Apache ECharts](https://github.com/apache/echarts)

## Metrics

| Scenario | What it measures | Unit |
| --- | --- | --- |
| `initialRender` | synchronous execution of init + full data load; libraries that defer work to async pipelines (klinecharts loads through its data loader) are measured at their scheduling cost — see `timeToSettledInitial` for the end-to-end view | ms |
| `timeToSettledInitial` | from `create()` to the first settled rendered frame (2×rAF after the work), median of 5; includes the same 2-rAF baseline for every library | ms |
| `fullUpdate` | synchronous execution of replacing the whole dataset on a live chart, median of 5; each repeat uses its own freshly seeded dataset (seeds 43–47) so no reference-equality shortcuts apply | ms |
| `timeToSettledUpdate` | from `applyData()` to the first settled rendered frame (2×rAF), median of 5 | ms |
| `tickUpdates` | synchronous time of 1000 sequential updates of the last (still forming) candle: open fixed, high/low only expand, close random-walks, volume accumulates | ms per tick |
| `prependBars` | synchronous cost of prepending a 1000-bar chunk of older history (5 chunks, median); the viewport stays pinned to the newest bars — this is the lazy-history-loading path | ms |
| `fpsPanZoom` | average FPS over 5s of synthetic drag pan (mouse+pointer event pairs) + wheel zoom every 500ms | fps |
| `frameP99PanZoom` | 99th percentile inter-frame time (between rAF callbacks) during the same window | ms |
| `jankPanZoom` | frames lasting ≥ 2× the median frame time and ≥ 16.7 ms (one missed 60 Hz frame) during the same window | count |
| `cpuPanZoom` | main-thread CPU time per rendered frame (cumulative CDP `TaskDuration` delta over the window ÷ frames); collected by the CLI runner from `__cpu:` markers, Chromium only | ms |
| `fpsCrosshair` | average FPS over 5s of synthetic hover with crosshair tracking (no buttons) | fps |
| `frameP99Crosshair` | frame p99 during the crosshair window | ms |
| `jankCrosshair` | janky-frame count during the crosshair window | count |
| `cpuCrosshair` | main-thread CPU per frame during the crosshair window (same CDP-based measurement) | ms |
| `visibleAllFps` | average FPS while panning with the whole dataset visible (no aggregation); klinecharts clamps bar spacing to ≥ 1px, so above ~800 bars it shows a 1px-per-bar window instead of the full dataset — an API limit, not a tuning choice | fps |
| `resize` | synchronous execution of a container resize (800×400 ↔ 640×360, alternating), median of 5 | ms |
| `destroyMs` | synchronous execution of chart disposal after a settled render, median of 5, each iteration in a fresh container | ms |
| `heapDelta` | retained JS heap growth after loading a chart with N bars; forced GC before both snapshots when available (Chromium only). Measures overhead **on top of** the input array — the bars already sit in the heap before the baseline snapshot, so zero-copy libraries (klinecharts keeps the caller's array) report near zero | MB |
| `heapPerBar` | derived: `heapDelta ÷ volume`, normalized memory cost per candle | KB |
| `leakPerCycle` | retained heap per create→destroy cycle (10 cycles after a warm-up cycle, GC around both snapshots); healthy libraries converge near zero | KB |
| `multiChartHeap` | total retained heap of 4 live charts with N bars each | MB |
| `multiChartFps` | FPS while panning one chart with three other live charts in the background | fps |
| `bundleSize` | production Vite build of a minimal one-chart page (modular imports only — for ECharts: `echarts/core` + candlestick chart, grid/dataZoom components, canvas renderer), raw + gzip | bytes |

## Fairness rules

- Chart container is 800×400 for every library, animations disabled.
- Identical seeded dataset (mulberry32, seed 42) for a given volume; `fullUpdate` replaces it with five per-repeat datasets (seeds 43–47) of the same volume, generated once per volume and shared by all adapters.
- Visible window is the last 120 candles in every library (except `visibleAllFps`, which zooms out as far as each API allows).
- ECharts uses the canvas renderer explicitly and enables an axis-triggered cross pointer for the crosshair scenario, matching what the other libraries render on hover.
- Pan/zoom/crosshair use the same synthetic input event trajectory for every library. Events are dispatched as mouse+pointer pairs because the libraries listen to different event families: klinecharts and lightweight-charts handle mouse events only, ECharts (zrender) mounts pointer listeners only — each library sees exactly one copy of every gesture. Events target the topmost canvas under the cursor, mirroring real hit-testing (lightweight-charts attaches its mouse handlers to the top overlay canvas; events dispatched on a sibling canvas never reach them).
- `prependBars` uses each library's realistic path for older history: lightweight-charts and ECharts re-set the full dataset with the view pinned to the newest bars (neither has an incremental prepend API); klinecharts additionally round-trips through its async data loader, so its synchronous number only covers scheduling — compare `timeToSettledUpdate` for its end-to-end cost. ECharts' tick path copies its data array per update (`slice()`), which is the straightforward usage its API encourages; noted, not hidden.
- `destroyMs` and `leakPerCycle` run every iteration in a fresh container: klinecharts and ECharts `init` on a container with a live chart returns the existing instance instead of creating a new one.

## Usage

```bash
pnpm install
pnpm exec playwright install chromium

# interactive harness page (manual runs, JSON download)
pnpm dev

# automated run via Playwright (headed by default for realistic FPS numbers)
pnpm bench
pnpm bench --headless --volumes=5000,10000

# bundle-size measurement only
pnpm size
```

Both interfaces report progress while a run is in flight, so long volume×adapter combinations don't look stalled: the harness page fills each table cell the moment its measurement lands (with a progress bar in the status line), and the CLI runner renders a live `[####------] NN%` progress bar (or per-stage log lines when stdout is not a TTY).

### Measuring local source instead of the npm release

By default the harness pins the published `klinecharts` package so results are reproducible. To benchmark a local checkout, point `KLINE_BENCH_LOCAL` at its source entry:

```bash
KLINE_BENCH_LOCAL=../KLineChart/src/index.ts pnpm dev
KLINE_BENCH_LOCAL=../KLineChart/src/index.ts pnpm bench
```

## Environment requirements

- Node.js 22+, pnpm.
- Memory metrics (`heapDelta`, `leakPerCycle`, `multiChartHeap`) require Chromium with `--enable-precise-memory-info`; the Playwright runner passes this automatically (plus `--js-flags=--expose-gc`). Columns show `—` in browsers without `performance.memory`. Without an exposed `gc()` the numbers are noisier and can occasionally go negative when the browser collects garbage mid-measurement.
- `cpuPanZoom` / `cpuCrosshair` are collected by the CLI runner (`pnpm bench`) via the Chrome DevTools Protocol: the page emits `__cpu:` markers around each fps window and the runner divides the cumulative `TaskDuration` delta by the frame count. `performance.eventLoopUtilization` is not exposed in window contexts, so the UI harness page cannot measure them — the columns show `—` there.
- For publishable FPS numbers run headed (`pnpm bench` without `--headless`) on a quiet machine, no other load, charger plugged in on laptops.

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
