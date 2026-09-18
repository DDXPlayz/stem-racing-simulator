/**
 * CALIBRATION · measured-vs-simulated comparison and parameter fitting.
 *
 * CSV columns (header names are matched loosely):
 *   time, distance, velocity, acceleration, run_number
 * Any of distance / velocity / acceleration may be blank; the fit uses
 * whatever is present.
 */
import { nominalRace } from './engine.js'
import { getParam } from './config.js'
import { clone } from './analysis.js'

const COLS = {
  time: ['time', 't', 'time_s', 'seconds'],
  distance: ['distance', 'x', 'position', 'dist', 'distance_m'],
  velocity: ['velocity', 'v', 'speed', 'velocity_ms'],
  acceleration: ['acceleration', 'a', 'accel'],
  run: ['run_number', 'run', 'lap', 'heat'],
}

export function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row')
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes('\t') ? '\t' : ','
  const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))
  const idx = {}
  for (const [k, names] of Object.entries(COLS)) idx[k] = header.findIndex(h => names.includes(h))
  if (idx.time < 0) throw new Error('No time column found (expected “time”)')
  if (idx.distance < 0 && idx.velocity < 0) throw new Error('Need at least a distance or a velocity column')
  const rows = []
  for (const line of lines.slice(1)) {
    const c = line.split(sep)
    const num = i => (i >= 0 && c[i] != null && c[i].trim() !== '' ? parseFloat(c[i]) : NaN)
    const t = num(idx.time)
    if (!Number.isFinite(t)) continue
    rows.push({ t, x: num(idx.distance), v: num(idx.velocity), a: num(idx.acceleration), run: idx.run >= 0 ? (parseInt(c[idx.run], 10) || 1) : 1 })
  }
  if (!rows.length) throw new Error('No numeric rows parsed')
  return rows
}

/** Group parsed rows by run number, sorted in time. */
export function groupRuns(rows) {
  const map = new Map()
  for (const r of rows) { if (!map.has(r.run)) map.set(r.run, []); map.get(r.run).push(r) }
  return [...map.entries()].map(([run, pts]) => ({ run, pts: pts.sort((a, b) => a.t - b.t) })).sort((a, b) => a.run - b.run)
}

function interp(trace, key, t) {
  // trace is ordered in t
  if (t <= trace[0].t) return trace[0][key]
  if (t >= trace[trace.length - 1].t) return trace[trace.length - 1][key]
  let lo = 0, hi = trace.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (trace[m].t <= t) lo = m; else hi = m }
  const a = trace[lo], b = trace[hi]
  const w = (t - a.t) / Math.max(1e-12, b.t - a.t)
  return a[key] + (b[key] - a[key]) * w
}

/**
 * Time at which the car first moves. Robust to sensor noise: the first sample
 * above the threshold that is followed by a sample that is higher still.
 */
function motionStart(pts, key = 'x', thr = 0.03) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i][key], b = pts[i + 1][key]
    if (Number.isFinite(a) && Number.isFinite(b) && a > thr && b > a) {
      // back-interpolate to the threshold crossing for a sub-sample estimate
      const prev = pts[i - 1]
      if (prev && Number.isFinite(prev[key]) && prev[key] < thr) return prev.t + ((thr - prev[key]) / (a - prev[key])) * (pts[i].t - prev.t)
      return pts[i].t
    }
  }
  return pts[0].t
}

/**
 * Compare measured runs against the nominal simulated run.
 * alignMode: 'motion' aligns both series at the first movement;
 *            'signal' assumes measured t=0 is the start signal (no shift).
 */
export function compare(inputs, runs, alignMode = 'motion') {
  const sim = nominalRace({ ...inputs, runs: 1 }, true).runs[0]
  const trace = sim.trace
  const simStart = motionStart(trace)
  const out = []
  for (const run of runs) {
    const hasX = run.pts.some(p => Number.isFinite(p.x)), hasV = run.pts.some(p => Number.isFinite(p.v))
    const measStart = alignMode === 'motion' ? (hasX ? motionStart(run.pts, 'x') : motionStart(run.pts, 'v', 0.5)) : 0
    const shift = alignMode === 'motion' ? simStart - measStart : 0
    const series = run.pts.map(p => {
      const ts = p.t + shift
      const sx = interp(trace, 'x', ts), sv = interp(trace, 'v', ts), sa = interp(trace, 'a', ts)
      return { t: p.t, x: p.x, v: p.v, a: p.a, sx, sv, sa, ex: Number.isFinite(p.x) ? p.x - sx : NaN, ev: Number.isFinite(p.v) ? p.v - sv : NaN, ea: Number.isFinite(p.a) ? p.a - sa : NaN }
    })
    const rms = k => { const vals = series.map(s => s[k]).filter(Number.isFinite); return vals.length ? Math.sqrt(vals.reduce((s, e) => s + e * e, 0) / vals.length) : NaN }
    const bias = k => { const vals = series.map(s => s[k]).filter(Number.isFinite); return vals.length ? vals.reduce((s, e) => s + e, 0) / vals.length : NaN }
    // finish time comparison if the measured run reaches the track length
    const finishMeas = hasX ? run.pts.find(p => p.x >= inputs.trackLength)?.t ?? null : null
    out.push({ run: run.run, series, shift, hasX, hasV, rmseX: rms('ex'), rmseV: rms('ev'), rmseA: rms('ea'), biasX: bias('ex'), biasV: bias('ev'), measFinish: finishMeas, simFinish: sim.tFinish - (alignMode === 'motion' ? shift : 0) })
  }
  return { sim, runs: out }
}

/** Cost = normalised RMSE across all runs (distance / track length, velocity / 10 m/s, acceleration / 100 m/s²). */
export function cost(inputs, runs, alignMode) {
  const c = compare(inputs, runs, alignMode)
  let s = 0, n = 0
  for (const r of c.runs) {
    if (Number.isFinite(r.rmseX)) { s += (r.rmseX / inputs.trackLength) ** 2; n++ }
    if (Number.isFinite(r.rmseV)) { s += (r.rmseV / 10) ** 2; n++ }
    if (Number.isFinite(r.rmseA)) { s += (r.rmseA / 100) ** 2; n++ }
  }
  return n ? Math.sqrt(s / n) : Infinity
}

export const CALIBRATABLE = ['cd', 'crr', 'impulse', 'thrustTau', 'launchEfficiency', 'launchDelay', 'tetherFriction', 'brakingDecel']

/**
 * Coordinate-descent fit of the selected parameters. Small problem, so a few
 * hundred simulations are enough; each is ~0.2 ms.
 */
export function calibrate(inputs, runs, keys = ['cd', 'crr', 'impulse', 'thrustTau'], { iterations = 12, alignMode = 'motion', initialRel = 0.2 } = {}) {
  let cur = clone(inputs)
  let best = cost(cur, runs, alignMode)
  const before = best
  const rel = Object.fromEntries(keys.map(k => [k, initialRel]))
  const trail = []
  for (let it = 0; it < iterations; it++) {
    let improved = false
    for (const k of keys) {
      const sch = getParam(k)
      const v0 = cur[k]
      let bestV = v0, bestC = best
      for (const m of [1, 1 / 3, 1 / 9]) {
        const step = Math.max(Math.abs(v0) * rel[k] * m, (sch?.step || 0.001))
        for (const cand of [v0 + step, v0 - step]) {
          const v = sch ? Math.min(sch.max, Math.max(sch.min, cand)) : cand
          if (v === v0) continue
          const c = cost({ ...cur, [k]: v }, runs, alignMode)
          if (c < bestC - 1e-10) { bestC = c; bestV = v }
        }
      }
      if (bestV !== v0) { cur = { ...cur, [k]: bestV }; best = bestC; improved = true; trail.push({ it, key: k, value: bestV, cost: bestC }) }
      else rel[k] *= 0.5
    }
    if (!improved && Math.max(...Object.values(rel)) < 1e-4) break
  }
  const changes = keys.filter(k => cur[k] !== inputs[k]).map(k => ({ key: k, from: inputs[k], to: cur[k], label: getParam(k)?.label || k, unit: getParam(k)?.unit || '' }))
  return { inputs: cur, before, after: best, changes, trail }
}
