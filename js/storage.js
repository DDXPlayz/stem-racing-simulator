/**
 * Persistence · localStorage only. Inputs, saved scenarios, calibration data
 * and UI preferences live under one key so export/import moves everything.
 */
import { mergeInputs } from './config.js'

const KEY = 'anantam-race-sim-v1'

export function load() {
  let raw = null
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { raw = null }
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    inputs: mergeInputs(s.inputs),
    scenarios: Array.isArray(s.scenarios) ? s.scenarios : [],
    calibrationCSV: typeof s.calibrationCSV === 'string' ? s.calibrationCSV : '',
    prefs: { mcN: 1000, ...(s.prefs || {}) },
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ inputs: state.inputs, scenarios: state.scenarios, calibrationCSV: state.calibrationCSV, prefs: state.prefs }))
  } catch { /* quota or private mode: ignore */ }
}

export function exportJSON(state) {
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), inputs: state.inputs, scenarios: state.scenarios, calibrationCSV: state.calibrationCSV }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `anantam-race-sim-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function importJSON(text) {
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object') throw new Error('Not a simulator export')
  return {
    inputs: mergeInputs(data.inputs),
    scenarios: Array.isArray(data.scenarios) ? data.scenarios : [],
    calibrationCSV: typeof data.calibrationCSV === 'string' ? data.calibrationCSV : '',
  }
}

export function newScenario(name, inputs, summary) {
  return { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, created: new Date().toISOString(), inputs: JSON.parse(JSON.stringify(inputs)), summary }
}
