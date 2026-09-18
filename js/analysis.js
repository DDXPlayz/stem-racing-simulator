/**
 * ANALYSIS LAYER · Monte Carlo, parameter sensitivity and what-if analysis.
 * Pure logic; no DOM.
 */
import { simulateRace, nominalRace } from './engine.js'
import { computeKPIs } from './kpi.js'
import { SENSITIVITY_PARAMS, getParam } from './config.js'
import { toSeed } from './rng.js'

export const clone = o => JSON.parse(JSON.stringify(o))

/* ---------------- statistics ---------------- */

export function percentile(sorted, q) {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function stats(values) {
  const n = values.length
  if (!n) return { n: 0, mean: NaN, median: NaN, sd: NaN, min: NaN, max: NaN, p5: NaN, p25: NaN, p75: NaN, p95: NaN }
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  const sd = n > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0
  return {
    n, mean, sd, median: percentile(sorted, 0.5), min: sorted[0], max: sorted[n - 1],
    p5: percentile(sorted, 0.05), p25: percentile(sorted, 0.25), p75: percentile(sorted, 0.75), p95: percentile(sorted, 0.95), sorted,
  }
}

export function histogram(values, bins = 30, range = null) {
  if (!values.length) return { edges: [], counts: [] }
  let lo = range ? range[0] : Math.min(...values), hi = range ? range[1] : Math.max(...values)
  if (hi - lo < 1e-9) { lo -= 0.01; hi += 0.01 }
  const w = (hi - lo) / bins
  const counts = new Array(bins).fill(0)
  for (const v of values) {
    let i = Math.floor((v - lo) / w)
    if (i >= bins) i = bins - 1
    if (i < 0) i = 0
    counts[i]++
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w)
  return { edges, counts, width: w }
}

/* ---------------- Monte Carlo ---------------- */

const yieldToUI = () => new Promise(r => setTimeout(r, 0))

/**
 * Run `n` full-race simulations with independent seeds derived from baseSeed.
 * Chunked so the UI can show progress. Resolves to a summary object.
 */
export async function runMonteCarlo(inputs, n, { baseSeed = 1, onProgress = null, chunk = 250, signal = null } = {}) {
  const totals = [], sims = []
  const runTimes = Array.from({ length: Math.max(1, Math.round(inputs.runs)) }, () => [])
  let incidents = 0, major = 0, penaltyFree = 0, beat = 0
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new Error('cancelled')
    const r = simulateRace(inputs, { seed: toSeed(`${baseSeed}:${i}`) })
    totals.push(r.total)
    r.runs.forEach((run, k) => runTimes[k]?.push(run.timed))
    if (r.anyIncident) incidents++
    if (r.anyMajor) major++
    if (r.penaltyFree) penaltyFree++
    if (r.total < inputs.targetTime) beat++
    sims.push({
      total: r.total, avgSpeed: r.avgSpeed, vMax: r.vMax, aMax: r.aMax, consistency: r.consistency, reliability: r.reliability,
      meanReaction: r.meanReaction, dragShare: r.dragShare, stoppingMargin: r.stoppingMargin, penalty: r.penaltyTime, incident: r.incidentTime, seed: r.seed,
    })
    if (i % chunk === chunk - 1) { onProgress?.((i + 1) / n); await yieldToUI() }
  }
  const st = stats(totals)
  const mean = k => sims.reduce((s, x) => s + x[k], 0) / sims.length
  const summary = {
    n, baseSeed, ms: performance.now() - t0, totals, stats: st,
    hist: histogram(totals, Math.min(40, Math.max(10, Math.round(Math.sqrt(n))))),
    pBeatTarget: beat / n, pIncident: incidents / n, pMajor: major / n, pPenaltyFree: penaltyFree / n,
    runStats: runTimes.map(stats),
    meanAvgSpeed: mean('avgSpeed'), meanVmax: mean('vMax'), meanAmax: mean('aMax'), meanConsistency: mean('consistency'),
    meanReliability: mean('reliability'), meanReaction: mean('meanReaction'), meanDragShare: mean('dragShare'),
    meanStoppingMargin: mean('stoppingMargin'), meanPenalty: mean('penalty'), meanIncident: mean('incident'),
    targetTime: inputs.targetTime,
    // the median simulation, for “typical race” displays
    medianSeed: sims.slice().sort((a, b) => Math.abs(a.total - st.median) - Math.abs(b.total - st.median))[0]?.seed,
  }
  onProgress?.(1)
  return summary
}

/** A race-shaped object built from MC means so the KPI engine can score the expected race. */
export function mcAsRace(mc, inputs) {
  const n = Math.max(1, Math.round(inputs.runs))
  return {
    runs: mc.runStats.map(s => ({ timed: s.mean })),
    total: mc.stats.mean, mean: mc.stats.mean / n, sd: mc.runStats.length > 1 ? Math.sqrt(mc.runStats.reduce((s, r) => s + r.sd ** 2, 0) / mc.runStats.length) : 0,
    consistency: mc.meanConsistency, reliability: mc.meanReliability, avgSpeed: mc.meanAvgSpeed, vMax: mc.meanVmax, aMax: mc.meanAmax,
    meanReaction: mc.meanReaction, dragShare: mc.meanDragShare, stoppingMargin: mc.meanStoppingMargin,
    penaltyTime: mc.meanPenalty, incidentTime: mc.meanIncident, breakdown: { braking: 0 },
  }
}

/* ---------------- sensitivity ---------------- */

/** Natural unit steps for the “time impact per unit” column. */
const UNIT_STEP = { mass: 1, cd: 0.01, frontalArea: 1, crr: 0.001, tetherFriction: 0.01, impulse: 0.05, thrustTau: 0.01, launchEfficiency: 1, launchDelay: 5, mechLoss: 1, wheelMass: 1, brakingDecel: 5, reaction: 0.01 }
const UNIT_LABEL = { mass: '1 g', cd: '0.01', frontalArea: '1 cm²', crr: '0.001', tetherFriction: '0.01 N', impulse: '0.05 N·s', thrustTau: '0.01 s', launchEfficiency: '1 %-pt', launchDelay: '5 ms', mechLoss: '1 %-pt', wheelMass: '1 g', brakingDecel: '5 m/s²', reaction: '10 ms' }

function applyParam(inputs, key, value) {
  const c = clone(inputs)
  if (key === 'reaction') c.drivers.forEach(d => { d.reactionMean = value })
  else c[key] = value
  return c
}
function readParam(inputs, key) {
  if (key === 'reaction') return inputs.drivers.reduce((s, d) => s + d.reactionMean, 0) / inputs.drivers.length
  return inputs[key]
}

/**
 * Controlled perturbation test on the deterministic (nominal) race.
 * Each parameter is moved ±rel (default 5 %) and the race re-simulated.
 */
export function sensitivity(inputs, params = SENSITIVITY_PARAMS, rel = 0.05) {
  const base = nominalRace(inputs).total
  const rows = []
  for (const prm of params) {
    const v0 = readParam(inputs, prm.key)
    if (!Number.isFinite(v0)) continue
    const delta = v0 !== 0 ? Math.abs(v0) * rel : rel
    const schema = getParam(prm.key)
    const lo = schema ? Math.max(schema.min, v0 - delta) : v0 - delta
    const hi = schema ? Math.min(schema.max, v0 + delta) : v0 + delta
    const tLo = nominalRace(applyParam(inputs, prm.key, lo)).total
    const tHi = nominalRace(applyParam(inputs, prm.key, hi)).total
    const slope = hi - lo > 0 ? (tHi - tLo) / (hi - lo) : 0 // s per unit of parameter
    const elasticity = v0 !== 0 ? (slope * v0) / base : 0    // %Δt per %Δparam
    const unitStep = UNIT_STEP[prm.key] ?? delta
    rows.push({
      key: prm.key, label: prm.label, value: v0, unit: schema?.unit || (prm.key === 'reaction' ? 's' : ''),
      lo, hi, tLo, tHi, base, slope, elasticity,
      impactPlus: tHi - base, impactMinus: tLo - base,
      perUnit: slope * unitStep, unitLabel: UNIT_LABEL[prm.key] || String(unitStep),
    })
  }
  const maxE = Math.max(1e-12, ...rows.map(r => Math.abs(r.elasticity)))
  for (const r of rows) {
    const rr = Math.abs(r.elasticity) / maxE
    r.rating = rr >= 0.5 ? 'High' : rr >= 0.2 ? 'Medium' : 'Low'
    r.relative = rr
  }
  rows.sort((a, b) => Math.abs(b.elasticity) - Math.abs(a.elasticity))
  return { base, rel, rows }
}

/* ---------------- what-if ---------------- */

/**
 * Compare baseline inputs with a modified copy. Deterministic race for the
 * headline numbers, plus an optional common-random-number Monte Carlo so the
 * probabilistic KPIs move for the same reason and not because of noise.
 */
export async function whatIf(inputs, modify, { mcN = 300, baseSeed = 7, onProgress = null } = {}) {
  const modified = clone(inputs)
  modify(modified)
  const baseRace = nominalRace(inputs), modRace = nominalRace(modified)
  let mcBase = null, mcMod = null
  if (mcN > 0) {
    mcBase = await runMonteCarlo(inputs, mcN, { baseSeed, onProgress: p => onProgress?.(p / 2) })
    mcMod = await runMonteCarlo(modified, mcN, { baseSeed, onProgress: p => onProgress?.(0.5 + p / 2) })
  }
  const kpiBase = computeKPIs(mcBase ? mcAsRace(mcBase, inputs) : baseRace, inputs, { mc: mcBase })
  const kpiMod = computeKPIs(mcMod ? mcAsRace(mcMod, modified) : modRace, modified, { mc: mcMod })
  const saved = baseRace.total - modRace.total
  return {
    inputs, modified, baseRace, modRace, mcBase, mcMod, kpiBase, kpiMod,
    baseline: baseRace.total, predicted: modRace.total, saved, pct: baseRace.total > 0 ? (saved / baseRace.total) * 100 : 0,
    kpiDelta: kpiMod.overall - kpiBase.overall,
    pBeatBase: mcBase?.pBeatTarget ?? null, pBeatMod: mcMod?.pBeatTarget ?? null,
  }
}
