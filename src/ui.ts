import { adapters } from './adapters'
import { generateBars } from './data'
import { DEFAULT_VOLUMES, runBenchmark, type BenchResults } from './runner'
import { SCENARIO_NAMES, type ScenarioName } from './scenarios'

const ALL_VOLUMES = DEFAULT_VOLUMES
const DEFAULT_SELECTED = [5000, 10000, 20000, 50000]
const PREVIEW_VOLUME = 5000

const SCENARIO_LABELS: Record<ScenarioName, { label: string; unit: string; higherIsBetter: boolean }> = {
  initialRender: { label: 'Initial render', unit: 'ms (median of 5)', higherIsBetter: false },
  fullUpdate: { label: 'Full data replace', unit: 'ms (median of 5)', higherIsBetter: false },
  tickUpdates: { label: 'Tick updates', unit: 'ms per tick (1000 ticks)', higherIsBetter: false },
  fpsPanZoom: { label: 'FPS pan + zoom', unit: 'fps over 5s', higherIsBetter: true },
  heapDelta: { label: 'Heap delta', unit: 'MB after load', higherIsBetter: false }
}

export function setupUI(): void {
  const controls = document.querySelector<HTMLElement>('#controls')
  const charts = document.querySelector<HTMLElement>('#charts')
  const results = document.querySelector<HTMLElement>('#results')
  if (controls === null || charts === null || results === null) {
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
  controls.appendChild(status)

  runButton.addEventListener('click', () => {
    void runFromUI(status, runButton, results)
  })

  renderPreview(charts)
}

function renderPreview(charts: HTMLElement): void {
  charts.innerHTML = ''
  const data = generateBars(PREVIEW_VOLUME)
  for (const adapter of adapters) {
    const card = document.createElement('div')
    card.className = 'chart-card'
    const title = document.createElement('h3')
    title.textContent = adapter.name
    const body = document.createElement('div')
    body.className = 'chart-body'
    card.append(title, body)
    charts.appendChild(card)
    adapter.create(body, data)
  }
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
      const best = pickBest(values, meta.higherIsBetter)
      const tr = document.createElement('tr')
      const cells = [`<td>${volume.toLocaleString('en-US')}</td>`]
      adapters.forEach((_adapter, index) => {
        cells.push(`<td class="${values[index] === best && best !== null ? 'best' : ''}">${formatValue(scenario, values[index])}</td>`)
      })
      tr.innerHTML = cells.join('')
      table.appendChild(tr)
    }
    root.appendChild(table)
  }

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

function pickBest(values: Array<number | null | undefined>, higherIsBetter: boolean): number | null {
  const present = values.filter((value): value is number => typeof value === 'number')
  if (present.length === 0) {
    return null
  }
  return higherIsBetter ? Math.max(...present) : Math.min(...present)
}

function formatValue(scenario: ScenarioName, value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (scenario === 'heapDelta') {
    return `${(value / 1024 / 1024).toFixed(1)} MB`
  }
  if (scenario === 'fpsPanZoom') {
    return value.toFixed(0)
  }
  if (scenario === 'tickUpdates') {
    return value.toFixed(4)
  }
  return value.toFixed(1)
}
