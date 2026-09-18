/**
 * KPI ENGINE · converts the model and a race result into performance indicators.
 *
 * Two groups:
 *   development – the team's nine development factors (weighted; these make
 *                 the Overall Performance Index). Computed from the nominal
 *                 model, so they describe the car design, not one noisy race.
 *                 Time-loss KPIs come from counterfactual simulations: the
 *                 nominal run minus the same run with that loss removed.
 *   outcome     – race-outcome indicators from the simulated race (or the
 *                 Monte Carlo mean). Scored against targets, unweighted.
 *
 * Weights and targets are TEAM-DEFINED (inputs.kpi) – not STEM Racing scoring.
 */
import { KPI_DEFS } from './config.js'
import { strategyEffect, yawMargin, yawRiskFactor } from './stochastic.js'
import { nominalRace } from './engine.js'
import { derive, slipThreshold, G } from './physics.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const clone = o => JSON.parse(JSON.stringify(o))
const f3 = v => (Number.isFinite(v) ? v.toFixed(3) : '—')
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
const f1 = v => (Number.isFinite(v) ? v.toFixed(1) : '—')

/** Linear scale used when a lower-is-better target is 0 (ratios are undefined). */
const ZERO_SCALE = { strategy: 0.25, penalty: 0.5 }

export function score(def, value, target) {
  if (!Number.isFinite(value)) return 0
  if (def.better === 'target') return clamp(100 * (1 - Math.abs(value - target) / (def.tol || 1)), 0, 100)
  if (def.better === 'higher') return target > 0 ? clamp((100 * value) / target, 0, 100) : 100
  if (target > 0) return value > 0 ? clamp((100 * target) / value, 0, 100) : 100
  const scale = ZERO_SCALE[def.key] || 1
  return clamp(100 * (1 - (value - target) / scale), 0, 100)
}

/** Expected time gained/lost by the chosen strategy versus Balanced, per race. */
export function strategyDelta(inputs) {
  const s = strategyEffect(inputs)
  const balanced = strategyEffect({ ...inputs, strategyMode: 1 })
  const n = Math.max(1, Math.round(inputs.runs))
  const reaction = (s.reactionShift - balanced.reactionShift) * n
  const falseStart = (s.falseStartProb - balanced.falseStartProb) * inputs.falseStartPenalty * n
  return { reaction, falseStart, total: reaction + falseStart }
}

/**
 * Development metrics of the car design from the nominal model.
 * Time losses are ms per run: nominal run time − counterfactual run time.
 */
export function developmentMetrics(inputs) {
  const n = Math.max(1, Math.round(inputs.runs))
  const base = nominalRace(inputs)
  const perRun = (race) => ((base.total - race.total) * 1000) / n
  const lost = (mutate) => { const c = clone(inputs); mutate(c); return perRun(nominalRace(c)) }
  const p = derive(inputs)
  const r0 = base.runs[0]
  const effEfficiency = (inputs.launchEfficiency / 100) * (1 - inputs.mechLoss / 100) * Math.max(0.2, 1 + (inputs.thrustTempCoeff / 100) * (inputs.temperature - 20)) * 100
  const aSlip = p.slipModel ? slipThreshold(p) : Infinity
  const noSlip = nominalRace({ ...inputs, slipModel: 0 })
  const aPeakNoSlip = noSlip.aMax
  return {
    base, n,
    launch: { efficiency: effEfficiency, F0: p.F0, impulse: p.impulse, launchTime: r0.breakdown.launchDelay + r0.breakdown.launch, aPeak: base.aMax },
    drag: lost(c => { c.cd = 0 }),
    mass: inputs.mass,
    wheelFriction: lost(c => { c.crr = 0 }),
    bearingFriction: lost(c => { c.bearingTorque = 0 }),
    yaw: { margin: yawMargin(inputs), risk: yawRiskFactor(inputs) },
    tether: lost(c => { c.tetherFriction = 0 }),
    slip: { loss: p.slipModel ? perRun(noSlip) : 0, ratio: Number.isFinite(aSlip) && aPeakNoSlip > 0 ? aSlip / aPeakNoSlip : Infinity, threshold: aSlip, aPeakNoSlip, time: r0.slip.time, distance: r0.slip.distance, enabled: p.slipModel },
    com: { rear: 50 + (inputs.comOffset / Math.max(1e-6, inputs.wheelbase)) * 100 },
  }
}

/**
 * @param race   result of simulateRace (single race) – or an MC-shaped race for the outcome group
 * @param inputs
 * @param ctx    { mc } optional Monte Carlo result; { dev } precomputed developmentMetrics
 */
export function computeKPIs(race, inputs, ctx = {}) {
  const T = inputs.kpi.targets, W = inputs.kpi.weights
  const mc = ctx.mc || null
  const dev = ctx.dev || developmentMetrics(inputs)
  const strat = strategyDelta(inputs)
  const items = []
  const push = (def, value, how, extra = {}) => {
    const target = T[def.key] ?? def.target
    const weight = def.group === 'development' ? (W[def.key] ?? def.weight) : 0
    items.push({ ...def, value, target, score: score(def, value, target), weight, how, ...extra })
  }
  for (const def of KPI_DEFS) {
    switch (def.key) {
      /* ---------- development group (nominal model) ---------- */
      case 'launch':
        push(def, dev.launch.efficiency, `Effective launch efficiency = η ${inputs.launchEfficiency} % × (1 − ${inputs.mechLoss} % loss) × temperature factor = ${f1(dev.launch.efficiency)} %. Gives peak thrust F₀ = ${f2(dev.launch.F0)} N, forward impulse ${f3(dev.launch.impulse)} N·s, peak acceleration ${f1(dev.launch.aPeak)} m/s², ${f3(dev.launch.launchTime)} s from start signal to the end of the launch zone. Score = 100 × value ÷ target.`)
        break
      case 'drag':
        push(def, dev.drag, `Nominal run minus the same run with Cd = 0: ${f1(dev.drag)} ms lost per run to drag (Cd ${inputs.cd}, A ${inputs.frontalArea} cm²). Score = 100 × target ÷ value.`)
        break
      case 'mass':
        push(def, dev.mass, `Race mass ${inputs.mass} g versus target ${T.mass ?? def.target} g. Effective inertial mass incl. wheels m_eff = ${f1(derive(inputs).mEff * 1000)} g. Score = 100 × target ÷ value.`)
        break
      case 'wheelFriction':
        push(def, dev.wheelFriction, `Nominal run minus the same run with Crr = 0: ${f2(dev.wheelFriction)} ms lost per run to wheel–track rolling resistance (Crr ${inputs.crr}, surface factor ${inputs.surfaceFactor}). Score = 100 × target ÷ value.`)
        break
      case 'bearingFriction':
        push(def, dev.bearingFriction, `Nominal run minus the same run with zero bearing torque: ${f2(dev.bearingFriction)} ms lost per run. F_bearing = 4 × ${inputs.bearingTorque} N·mm ÷ ${(inputs.wheelDiameter / 2).toFixed(1)} mm = ${f3(derive(inputs).bearing)} N. Score = 100 × target ÷ value.`)
        break
      case 'yaw':
        push(def, dev.yaw.margin, `Static yaw margin = centre of pressure ${inputs.cpOffset} mm aft of CoM ÷ wheelbase ${inputs.wheelbase} mm = ${f1(dev.yaw.margin)} %. Lane-deviation incident probability is scaled ×${f2(dev.yaw.risk)} by this margin. Score = 100 × value ÷ target.`)
        break
      case 'tether':
        push(def, dev.tether, `Nominal run minus the same run with zero tether friction: ${f2(dev.tether)} ms lost per run (${inputs.tetherFriction} N × track condition ${inputs.trackCondition}). Score = 100 × target ÷ value.`)
        break
      case 'slip':
        push(def, dev.slip.enabled ? dev.slip.ratio : Infinity, dev.slip.enabled
          ? `Traction ratio = μ_s·m·g ÷ (k·m_wheels·a_peak) = ${f1(dev.slip.threshold)} ÷ ${f1(dev.slip.aPeakNoSlip)} m/s² = ${f2(dev.slip.ratio)}${dev.slip.ratio < 1 ? ' → the wheels slip at launch' : ' → no slip'}. Modelled: wheels slipped for ${f3(dev.slip.time)} s over ${f2(dev.slip.distance)} m; net time effect versus perfect traction ${dev.slip.loss >= 0 ? '+' : ''}${f1(dev.slip.loss)} ms per run (positive = time lost). Lateral instability and wheel wear from slip are not modelled. Score = 100 × ratio ÷ target.`
          : 'Wheel-slip model is off: perfect traction assumed.')
        break
      case 'com':
        push(def, dev.com.rear, `Rear weight share = 50 % + CoM offset ${inputs.comOffset} mm ÷ wheelbase ${inputs.wheelbase} mm = ${f1(dev.com.rear)} % rear. Score = 100 at the ${T.com ?? def.target} % target, falling to 0 at ± ${def.tol} points.`)
        break
      /* ---------- outcome group (simulated race) ---------- */
      case 'raceTime': {
        const v = mc ? mc.stats.mean : race.total
        push(def, v, `${mc ? 'Mean Monte Carlo race time' : 'Simulated race time'} ${f3(v)} s = Σ run times (${race.runs.map(r => f3(r.timed)).join(' + ')}). Score = 100 × target ÷ value.`)
        break
      }
      case 'speed':
        push(def, race.avgSpeed, `Average of run speeds over the timed ${inputs.trackLength} m from car release to finish gate: ${f2(race.avgSpeed)} m/s. Score = 100 × value ÷ target.`)
        break
      case 'acceleration':
        push(def, race.aMax, `Peak acceleration in any run ${f1(race.aMax)} m/s² (= F_net,max ÷ m_eff). Score = 100 × value ÷ target.`)
        break
      case 'reaction':
        push(def, race.meanReaction, `Mean driver reaction over ${race.runs.length} run(s): ${f3(race.meanReaction)} s, including strategy shift and any poor-reaction incidents. Score = 100 × target ÷ value.`)
        break
      case 'consistency': {
        const v = (mc ? mc.meanConsistency : race.consistency) * 100
        push(def, v, `Consistency = 1 − σ/μ of the run times = 1 − ${f3(race.sd)} ÷ ${f3(race.mean)} = ${f2(race.consistency * 100)} %${mc ? ` (Monte Carlo mean ${f2(v)} %)` : ''}.`)
        break
      }
      case 'reliability': {
        const v = (mc ? mc.meanReliability : race.reliability) * 100
        push(def, v, `${mc ? 'Across all simulations, the mean share' : 'Share'} of runs finished without a moderate/major incident, false start or braking-zone overrun: ${f1(v)} %.`)
        break
      }
      case 'braking': {
        const margin = race.stoppingMargin * 100
        push(def, margin, `Stopping margin = (zone − stopping distance) ÷ zone = ${f1(margin)} % of the ${inputs.brakingZone} m zone.${inputs.timingMode === 1 ? ` Braking adds ${f3(race.breakdown.braking)} s to the timed result (full-stop timing).` : ' Timing stops at the finish gate, so braking costs no time in this format.'}`)
        break
      }
      case 'strategy':
        push(def, strat.total, `Expected Δt vs Balanced strategy: reaction ${strat.reaction >= 0 ? '+' : ''}${f3(strat.reaction)} s, false-start risk ${strat.falseStart >= 0 ? '+' : ''}${f3(strat.falseStart)} s. Negative = time gained.`)
        break
      case 'penalty': {
        const v = race.penaltyTime + race.incidentTime
        push(def, v, `Penalty time ${f3(race.penaltyTime)} s + incident delay ${f3(race.incidentTime)} s = ${f3(v)} s in the race total.`)
        break
      }
      default: break
    }
  }
  const devItems = items.filter(k => k.group === 'development')
  const wSum = devItems.reduce((s, k) => s + k.weight, 0)
  const overall = wSum > 0 ? devItems.reduce((s, k) => s + k.weight * k.score, 0) / wSum : 0
  return { items, development: devItems, outcome: items.filter(k => k.group === 'outcome'), overall, weightSum: wSum, strategy: strat, dev }
}

/** Formats a KPI raw value with its unit. */
export function fmtKPI(k) {
  const v = k.value
  if (!Number.isFinite(v)) return v === Infinity ? '∞' : '—'
  if (k.unit === 's') return `${v.toFixed(3)} s`
  if (k.unit === 'ms') return `${v.toFixed(1)} ms`
  if (k.unit === '%') return `${v.toFixed(1)} %`
  if (k.unit === '% rear') return `${v.toFixed(1)} % rear`
  if (k.unit === 'g') return `${v.toFixed(1)} g`
  if (k.unit === 'm/s') return `${v.toFixed(2)} m/s`
  if (k.unit === 'm/s²') return `${v.toFixed(1)} m/s²`
  return v.toFixed(2)
}
