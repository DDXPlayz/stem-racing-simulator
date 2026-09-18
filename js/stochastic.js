/**
 * STOCHASTIC LAYER · samples the uncertain variables for one run.
 *
 * Produces (a) a bag of multiplicative factors for the physics model,
 * (b) the driver’s reaction time and (c) the list of incidents that occur.
 * In deterministic mode every factor is its mean and no incidents occur.
 */
import { INCIDENT_TYPES } from './config.js'

const STRATEGY_SHIFT = { 0: -1, 1: 0, 2: 1 } // conservative, balanced, aggressive

/** Driver chosen for a given run index according to the allocation setting. */
export function pickDriver(inputs, runIndex) {
  const ds = inputs.drivers
  if (!ds.length) return null
  const alloc = inputs.driverAllocation
  if (Array.isArray(alloc)) return ds.find(d => d.id === alloc[runIndex % alloc.length]) || ds[0]
  if (alloc === 'best') return ds.reduce((a, b) => (b.reactionMean * b.performanceFactor < a.reactionMean * a.performanceFactor ? b : a))
  if (alloc === 'alternate') return ds[runIndex % ds.length]
  return ds.find(d => d.id === alloc) || ds[0]
}

/** Static yaw margin: centre of pressure aft of the CoM, as % of wheelbase. */
export function yawMargin(inputs) {
  return inputs.wheelbase > 0 ? ((inputs.cpOffset || 0) / inputs.wheelbase) * 100 : 0
}

/**
 * Yaw-stability coupling to the lane-deviation incident. A car with a 10 %
 * margin is the reference (factor 1); less margin raises the probability,
 * more lowers it, floored at 0.25. Model assumption, adjustable via yawCoupling.
 */
export function yawRiskFactor(inputs) {
  const k = inputs.yawCoupling ?? 1
  return Math.max(0.25, 1 + k * (10 - yawMargin(inputs)) / 10)
}

/** Strategy adjustment of the reaction distribution and false-start risk. */
export function strategyEffect(inputs) {
  const dir = STRATEGY_SHIFT[inputs.strategyMode] ?? 0
  const risk = inputs.riskLevel / 100
  const gain = (inputs.anticipationGain / 1000) * risk
  return {
    reactionShift: dir > 0 ? -gain : dir < 0 ? +gain * 0.5 : 0,
    sdScale: dir > 0 ? 1 + 0.5 * risk : dir < 0 ? 1 - 0.3 * risk : 1,
    falseStartProb: dir > 0 ? (inputs.falseStartProbMax / 100) * risk : dir < 0 ? 0 : (inputs.falseStartProbMax / 100) * 0.1,
  }
}

/**
 * Sample everything random about one run.
 * @returns {{factors, reaction, falseStart, incidents, driver, transition}}
 */
export function sampleRun(inputs, driver, rng, { deterministic = false } = {}) {
  const cv = k => (inputs[k] || 0) / 100
  const strat = strategyEffect(inputs)
  const perf = driver?.performanceFactor ?? 1
  const reactMean = (driver?.reactionMean ?? 0.18) * perf + strat.reactionShift
  const reactSd = (driver?.reactionSd ?? 0) * strat.sdScale

  if (deterministic) {
    return {
      driver, factors: {}, reaction: Math.max(0.02, reactMean), falseStart: false, incidents: [],
      transition: inputs.transitionTime, thrustNoiseCv: 0,
    }
  }

  const launchCons = driver?.launchConsistency ?? 1
  const brakeCons = driver?.brakingConsistency ?? 1
  const factors = {
    thrust: rng.factor(cv('thrustCv')),
    launchEff: rng.factor(cv('launchCv') * launchCons),
    aero: rng.factor(cv('aeroCv')),
    roll: rng.factor(cv('rollCv')),
    braking: rng.factor(cv('brakingCv') * brakeCons),
    env: rng.factor(cv('envVariability')),
    tether: 1,
    extraDelay: Math.max(0, rng.normal(0, 0.004 * launchCons)), // ± a few ms of piercing scatter
  }
  // lane effects: systematic bias plus random scatter, expressed as added time
  const laneDelay = (inputs.laneBias + rng.normal(0, inputs.laneVariation)) / 1000

  // reaction: log-normal keeps it positive and right-skewed like real data
  let reaction = rng.lognormal(Math.max(0.02, reactMean), reactSd)
  const falseStart = rng.bernoulli(strat.falseStartProb)

  // incidents
  const incidents = []
  for (const t of INCIDENT_TYPES) {
    const cfg = inputs.incidents[t.key]
    if (!cfg) continue
    let p = cfg.prob
    if (t.key === 'poorReaction') p = 1 - (1 - p) * (1 - (driver?.errorProb ?? 0))
    if (t.key === 'laneDeviation') p = Math.min(1, p * yawRiskFactor(inputs))
    if (!rng.bernoulli(p)) continue
    const magnitude = rng.uniform(cfg.min, cfg.max)
    incidents.push({ key: t.key, label: t.label, severity: t.severity, magnitude, unit: t.unit })
  }
  let thrustNoiseCv = 0
  for (const inc of incidents) {
    switch (inc.key) {
      case 'delayedLaunch': factors.extraDelay += inc.magnitude; break
      case 'poorReaction': reaction += inc.magnitude; break
      case 'brakingError': factors.braking *= 1 - inc.magnitude; break
      case 'mechanical': factors.thrust *= 1 - inc.magnitude; break
      case 'laneDeviation': factors.aero *= 1 + inc.magnitude; factors.tether *= 1 + 2 * inc.magnitude; break
      case 'inconsistent': thrustNoiseCv += inc.magnitude; factors.roll *= 1 + inc.magnitude; break
      default: break
    }
  }
  const transition = Math.max(0, rng.normal(inputs.transitionTime, inputs.transitionTime * cv('transitionCv')))
  return { driver, factors, reaction, laneDelay, falseStart, incidents, transition, thrustNoiseCv }
}
