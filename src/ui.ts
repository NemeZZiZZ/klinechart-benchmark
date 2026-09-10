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

  const progress = document.createElement('div')
  progress.id = 'progress'
  progress.style.display = 'none'
  const progressFill = document.createElement('div')
  progressFill.id = 'progress-fill'
  progress.appendChild(progressFill)
  controls.appendChild(progress)

  runButton.addEventListener('click', () => {
    void runFromUI(status, runButton, results, progress, progressFill)
  })
}

async function runFromUI(status: HTMLElement, runButton: HTMLButtonElement, results: HTMLElement, progress: HTMLElement, progressFill: HTMLElement): Promise<void> {
  const selected = [...document.querySelectorAll<HTMLInputElement>('#controls input[type=checkbox]:checked')].map((checkbox) => Number(checkbox.value)).sort((a, b) => a - b)
  if (selected.length === 0) {
    status.textContent = 'Select at least one volume.'
    return
  }
  runButton.disabled = true
  const refs = renderSkeleton(results, selected)
  progress.style.display = ''
  progressFill.style.width = '0%'
  status.textContent = 'Running…'
  try {
    const bench = await runBenchmark({
      volumes: selected,
      onProgress: (message, progressInfo) => {
        status.textContent = `Running… ${message}`
        if (progressInfo !== undefined) {
          const percent = Math.round((progressInfo.done / progressInfo.total) * 100)
          progressFill.style.width = `${percent}%`
          status.textContent = `Running… ${message} (${percent}%)`
        }
      },
      onPartial: (partial, updated) => {
        if (updated !== undefined) {
          updateRow(refs, partial, updated.scenario, updated.volume)
        }
      }
    })
    status.textContent = 'Done.'
    finalizeTables(refs)
    appendDownloadAction(results, bench)
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`
    finalizeTables(refs)
  } finally {
    progress.style.display = 'none'
    runButton.disabled = false
  }
}

interface TableRefs {
  rows: Map<string, HTMLTableRowElement>
  heapRows: Map<string, HTMLTableRowElement>
}

// Build every table up front with empty value cells; measurements then fill
// the cells in one by one, so progress is visible while the run continues.
function renderSkeleton(root: HTMLElement, volumes: number[]): TableRefs {
  root.innerHTML = ''
  const rows = new Map<string, HTMLTableRowElement>()
  const heapRows = new Map<string, HTMLTableRowElement>()

  const appendTable = (scenario: string, target: Map<string, HTMLTableRowElement>): void => {
    const table = document.createElement('table')
    const headerRow = document.createElement('tr')
    headerRow.innerHTML = `<th>Volume</th>${adapters.map((adapter) => `<th>${adapter.name}</th>`).join('')}`
    table.appendChild(headerRow)
    for (const volume of volumes) {
      const tr = document.createElement('tr')
      const volumeCell = document.createElement('td')
      volumeCell.textContent = volume.toLocaleString('en-US')
      tr.appendChild(volumeCell)
      for (const _adapter of adapters) {
        const td = document.createElement('td')
        tr.appendChild(td)
      }
      table.appendChild(tr)
      target.set(`${scenario}:${volume}`, tr)
    }
    root.appendChild(table)
  }

  for (const scenario of SCENARIO_NAMES) {
    const meta = SCENARIO_LABELS[scenario]
    const heading = document.createElement('h2')
    heading.textContent = `${meta.label}`
    root.appendChild(heading)

    const note = document.createElement('p')
    note.className = 'unit-note'
    note.textContent = `Unit: ${meta.unit}.`
    root.appendChild(note)

    appendTable(scenario, rows)
  }

  const heading = document.createElement('h2')
  heading.textContent = 'Heap per bar'
  root.appendChild(heading)

  const note = document.createElement('p')
  note.className = 'unit-note'
  note.textContent = 'Unit: KB per bar (derived: heapDelta ÷ volume).'
  root.appendChild(note)

  appendTable('heapPerBar', heapRows)

  return { rows, heapRows }
}

function updateRow(refs: TableRefs, partial: BenchResults['results'], scenario: ScenarioName, volume: number): void {
  const tr = refs.rows.get(`${scenario}:${volume}`)
  if (tr === undefined) {
    return
  }
  const meta = SCENARIO_LABELS[scenario]
  const row = partial[scenario]?.[String(volume)] ?? {}
  const values = adapters.map((adapter) => row[adapter.name])
  const marks = pickBest(scenario, values, meta.higherIsBetter)
  adapters.forEach((_adapter, index) => {
    const td = tr.children[index + 1]
    if (td !== undefined) {
      td.textContent = formatValue(scenario, values[index])
      td.className = marks[index] ? 'best' : ''
    }
  })

  if (scenario === 'heapDelta') {
    const heapTr = refs.heapRows.get(`heapPerBar:${volume}`)
    if (heapTr !== undefined) {
      const perBar = adapters.map((adapter) => {
        const heap = row[adapter.name]
        return typeof heap === 'number' ? heap / volume / 1024 : null
      })
      const present = perBar.filter((value): value is number => value !== null)
      const best = present.length > 1 && new Set(present.map((value) => value.toFixed(2))).size > 1 ? Math.min(...present) : null
      adapters.forEach((_adapter, index) => {
        const td = heapTr.children[index + 1]
        if (td !== undefined) {
          const value = perBar[index]
          const isBest = best !== null && value !== null && value.toFixed(2) === best.toFixed(2)
          td.textContent = value === null ? '—' : `${value.toFixed(2)} KB`
          td.className = isBest ? 'best' : ''
        }
      })
    }
  }
}

function finalizeTables(refs: TableRefs): void {
  for (const tr of [...refs.rows.values(), ...refs.heapRows.values()]) {
    for (const td of tr.children) {
      if (td.textContent === '') {
        td.textContent = '—'
      }
    }
  }
}

function appendDownloadAction(root: HTMLElement, bench: BenchResults): void {
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
