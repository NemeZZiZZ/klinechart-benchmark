import { adapters } from './adapters'
import { type BenchResults, DEFAULT_VOLUMES, runBenchmark } from './runner'
import { SCENARIO_NAMES, type ScenarioName } from './scenarios'

const ALL_VOLUMES = DEFAULT_VOLUMES
const DEFAULT_SELECTED = [5000, 10000, 20000, 50000]

const SCENARIO_LABELS: Record<ScenarioName, { label: string; unit: string; higherIsBetter: boolean }> = {
  initialRender: { label: 'Initial render (sync)', unit: 'ms (median of 5)', higherIsBetter: false },
  timeToSettledInitial: { label: 'Initial render → settled frame', unit: 'ms (median of 5, includes 2 rAF baseline)', higherIsBetter: false },
  fullUpdate: { label: 'Full data replace (sync)', unit: 'ms (median of 5)', higherIsBetter: false },
  timeToSettledUpdate: { label: 'Full replace → settled frame', unit: 'ms (median of 5, includes 2 rAF baseline)', higherIsBetter: false },
  tickUpdates: { label: 'Tick updates', unit: 'ms per tick (1000 ticks)', higherIsBetter: false },
  prependBars: { label: 'Prepend 1000 older bars', unit: 'ms (median of 5)', higherIsBetter: false },
  fpsPanZoom: { label: 'FPS pan + zoom', unit: 'fps over 5s', higherIsBetter: true },
  frameP99PanZoom: { label: 'Frame p99 (pan + zoom)', unit: 'ms between rAF frames', higherIsBetter: false },
  jankPanZoom: { label: 'Janky frames (pan + zoom)', unit: 'count over 5s (≥ 2× median and ≥ 16.7 ms)', higherIsBetter: false },
  cpuPanZoom: { label: 'CPU per frame (pan + zoom)', unit: 'ms main-thread CPU per frame (CLI runner only, shows — here)', higherIsBetter: false },
  fpsCrosshair: { label: 'FPS crosshair', unit: 'fps over 5s', higherIsBetter: true },
  frameP99Crosshair: { label: 'Frame p99 (crosshair)', unit: 'ms between rAF frames', higherIsBetter: false },
  jankCrosshair: { label: 'Janky frames (crosshair)', unit: 'count over 5s (≥ 2× median and ≥ 16.7 ms)', higherIsBetter: false },
  cpuCrosshair: { label: 'CPU per frame (crosshair)', unit: 'ms main-thread CPU per frame (CLI runner only, shows — here)', higherIsBetter: false },
  visibleAllFps: { label: 'FPS pan, all bars visible', unit: 'fps over 5s', higherIsBetter: true },
  resize: { label: 'Resize', unit: 'ms (median of 5)', higherIsBetter: false },
  destroyMs: { label: 'Destroy', unit: 'ms (median of 5)', higherIsBetter: false },
  heapDelta: { label: 'Heap delta', unit: 'MB after load', higherIsBetter: false },
  leakPerCycle: { label: 'Leak per create→destroy cycle', unit: 'KB per cycle (10 cycles)', higherIsBetter: false },
  multiChartHeap: { label: 'Heap, 4 charts live', unit: 'MB total', higherIsBetter: false },
  multiChartFps: { label: 'FPS pan, 4 charts live', unit: 'fps over 5s', higherIsBetter: true }
}

export function setupUI(): void {
  const controls = document.querySelector<HTMLElement>('#controls')
  const results = document.querySelector<HTMLElement>('#results')
  if (controls === null || results === null) {
    throw new Error('benchmark page shell missing')
  }

  controls.innerHTML = ''

  for (const volume of ALL_VOLUMES) {
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = String(volume)
    checkbox.checked = DEFAULT_SELECTED.includes(volume)
    checkbox.dataset.volume = String(volume)
    label.append(checkbox, `${volume.toLocaleString('en-US')} bars`)
    controls.appendChild(label)
  }

  const runButton = document.createElement('button')
  runButton.type = 'button'
  runButton.textContent = 'Run benchmark'
  controls.appendChild(runButton)

  const status = document.createElement('div')
  status.id = 'status'
  status.textContent = 'Charts are measured offscreen in fixed 800×400 containers — see README for methodology.'
  controls.appendChild(status)

  runButton.addEventListener('click', () => {
    void runFromUI(status, runButton, results)
  })
}

async function runFromUI(status: HTMLElement, runButton: HTMLButtonElement, results: HTMLElement): Promise<void> {
  const selected = [...document.querySelectorAll<HTMLInputElement>('#controls input[type=checkbox]:checked')].map((checkbox) => Number(checkbox.value)).sort((a, b) => a - b)
  if (selected.length === 0) {
    status.textContent = 'Select at least one volume.'
    return
  }
  runButton.disabled = true
  results.innerHTML = ''
  status.textContent = 'Running…'
  try {
    const bench = await runBenchmark({
      volumes: selected,
      onProgress: (message) => {
        status.textContent = `Running… ${message}`
      }
    })
    status.textContent = 'Done.'
    renderResults(results, bench)
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    runButton.disabled = false
  }
}

function renderResults(root: HTMLElement, bench: BenchResults): void {
  root.innerHTML = ''

  for (const scenario of SCENARIO_NAMES) {
    const meta = SCENARIO_LABELS[scenario]
    const heading = document.createElement('h2')
    heading.textContent = `${meta.label}`
    root.appendChild(heading)

    const note = document.createElement('p')
    note.className = 'unit-note'
    note.textContent = `Unit: ${meta.unit}.`
    root.appendChild(note)

    const table = document.createElement('table')
    const headerRow = document.createElement('tr')
    headerRow.innerHTML = `<th>Volume</th>${adapters.map((adapter) => `<th>${adapter.name}</th>`).join('')}`
    table.appendChild(headerRow)

    const volumes = Object.keys(bench.results[scenario] ?? {})
      .map(Number)
      .sort((a, b) => a - b)
    for (const volume of volumes) {
      const row = bench.results[scenario]?.[String(volume)] ?? {}
      const values = adapters.map((adapter) => row[adapter.name])
      const marks = pickBest(scenario, values, meta.higherIsBetter)
      const tr = document.createElement('tr')
      const cells = [`<td>${volume.toLocaleString('en-US')}</td>`]
      adapters.forEach((_adapter, index) => {
        cells.push(`<td class="${marks[index] ? 'best' : ''}">${formatValue(scenario, values[index])}</td>`)
      })
      tr.innerHTML = cells.join('')
      table.appendChild(tr)
    }
    root.appendChild(table)
  }

  renderHeapPerBar(root, bench)

  const actions = document.createElement('div')
  actions.className = 'actions'
  const download = document.createElement('button')
  download.type = 'button'
  download.textContent = 'Download JSON'
  download.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(bench, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `klinecharts-benchmark-${bench.meta.date.slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  })
  actions.appendChild(download)
  root.appendChild(actions)
}

function renderHeapPerBar(root: HTMLElement, bench: BenchResults): void {
  const heading = document.createElement('h2')
  heading.textContent = 'Heap per bar'
  root.appendChild(heading)

  const note = document.createElement('p')
  note.className = 'unit-note'
  note.textContent = 'Unit: KB per bar (derived: heapDelta ÷ volume).'
  root.appendChild(note)

  const table = document.createElement('table')
  const headerRow = document.createElement('tr')
  headerRow.innerHTML = `<th>Volume</th>${adapters.map((adapter) => `<th>${adapter.name}</th>`).join('')}`
  table.appendChild(headerRow)

  const volumes = Object.keys(bench.results.heapDelta ?? {})
    .map(Number)
    .sort((a, b) => a - b)
  for (const volume of volumes) {
    const row = bench.results.heapDelta?.[String(volume)] ?? {}
    const values = adapters.map((adapter) => {
      const heap = row[adapter.name]
      return typeof heap === 'number' ? heap / volume / 1024 : null
    })
    const present = values.filter((value): value is number => value !== null)
    const best = present.length > 1 && new Set(present.map((value) => value.toFixed(2))).size > 1 ? Math.min(...present) : null
    const tr = document.createElement('tr')
    const cells = [`<td>${volume.toLocaleString('en-US')}</td>`]
    for (const value of values) {
      const isBest = best !== null && value !== null && value.toFixed(2) === best.toFixed(2)
      cells.push(`<td class="${isBest ? 'best' : ''}">${value === null ? '—' : `${value.toFixed(2)} KB`}</td>`)
    }
    tr.innerHTML = cells.join('')
    table.appendChild(tr)
  }
  root.appendChild(table)
}

function displayValue(scenario: ScenarioName, value: number): number {
  if (scenario === 'heapDelta' || scenario === 'multiChartHeap') {
    return Math.round((value / 1024 / 1024) * 10) / 10
  }
  if (scenario === 'leakPerCycle') {
    return Math.round((value / 1024) * 100) / 100
  }
  const digits = formatDigits(scenario)
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatDigits(scenario: ScenarioName): number {
  if (scenario === 'fpsPanZoom' || scenario === 'fpsCrosshair' || scenario === 'visibleAllFps' || scenario === 'multiChartFps' || scenario === 'jankPanZoom' || scenario === 'jankCrosshair') {
    return 0
  }
  if (scenario === 'tickUpdates' || scenario === 'cpuPanZoom' || scenario === 'cpuCrosshair') {
    return 4
  }
  return 1
}

function pickBest(scenario: ScenarioName, values: Array<number | null | undefined>, higherIsBetter: boolean): boolean[] {
  const displayed = values.map((value) => (typeof value === 'number' ? displayValue(scenario, value) : null))
  const present = displayed.filter((value): value is number => value !== null)
  if (present.length < 2) {
    return values.map(() => false)
  }
  const best = higherIsBetter ? Math.max(...present) : Math.min(...present)
  if (!present.some((value) => value !== best)) {
    return values.map(() => false)
  }
  return displayed.map((value) => value === best)
}

function formatValue(scenario: ScenarioName, value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (scenario === 'heapDelta' || scenario === 'multiChartHeap') {
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }
  if (scenario === 'leakPerCycle') {
    return `${(value / 1024).toFixed(2)} KB`
  }
  return value.toFixed(formatDigits(scenario))
}
