# KLineChart Benchmark

Reproducible performance comparison of three charting libraries rendering the same OHLCV data:

- [klinecharts](https://github.com/klinecharts/KLineChart)
- [lightweight-charts](https://github.com/tradingview/lightweight-charts)
- [Apache ECharts](https://github.com/apache/echarts)

## Metrics

| Scenario | What it measures | Unit |
| --- | --- | --- |
| `initialRender` | init + full data load to a settled rendered frame, median of 5 | ms |
| `fullUpdate` | replacing the whole dataset on a live chart, median of 5 | ms |
| `tickUpdates` | 1000 sequential updates of the last candle | ms per tick |
| `fpsPanZoom` | average FPS over 5s of synthetic pointer pan + wheel zoom | fps |
| `heapDelta` | JS heap growth after loading a chart with N bars (Chromium only) | MB |
| `bundleSize` | production Vite build of a minimal one-chart page, raw + gzip | bytes |

## Fairness rules

- Chart container is 800×400 for every library, animations disabled.
- Identical seeded dataset (mulberry32, seed 42) for a given volume.
- Visible window is the last 120 candles in every library.
- ECharts uses the canvas renderer explicitly.
- Pan/zoom uses the same synthetic input event trajectory for every library.

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
- `heapDelta` requires Chromium with `--enable-precise-memory-info`; the Playwright runner passes this automatically. The column shows `—` in browsers without `performance.memory`.
- For publishable FPS numbers run headed (`pnpm run` without `--headless`) on a quiet machine, no other load, charger plugged in on laptops.

## Results format

Each run writes `results/<timestamp>.json` (committed runs serve as reference data):

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
