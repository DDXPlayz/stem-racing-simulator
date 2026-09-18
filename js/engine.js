/**
 * SIMULATION ENGINE · time-step race simulation.
 *
 * A race is `inputs.runs` consecutive runs of the track. Each run is
 * integrated with a fixed time step through the phases
 *   reaction → launch → acceleration → high-speed → braking → transition
 * and the results are aggregated into a race result with a full time
 * breakdown and sanity checks.
 */
import { RNG, randomSeed, toSeed } from './rng.js'
import { derive, forces, stoppingDistance, slipThreshold, G } from './physics.js'
import { sampleRun, pickDriver } from './stochastic.js'

export const PHASES = ['reaction', 'launch', 'acceleration', 'highSpeed', 'braking', 'transition']
export const PHASE_LABEL = { reaction: 'Reaction', launch: 'Launch', acceleration: 'Acceleration', highSpeed: 'Max-speed region', braking: 'Braking', transition: 'Transition', penalty: 'Penalty', incident: 'Incident delay' }

/**
 * Simulate one run.
 * @param inputs   UI inputs
 * @param sample   output of sampleRun()
 * @param opts     { recordTrace, thrustRng }
 */
export function simulateRun(inputs, sample, opts = {}) {
  const p = derive(inputs, sample.factors)
  const dt = p.dt
  const trace = opts.recordTrace ? [] : null
  const checks = []

  // Time before the car can move: driver reaction + launch-system delay (+ incident delays).
  const reaction = Math.max(0.0, sample.reaction)
  const tRelease = reaction + p.launchDelay // gas release instant
  const laneDelay = sample.laneDelay || 0

  let t = 0, x = 0, v = 0, a = 0
  let phase = 'reaction'
  let tFinish = null, tLaunchEnd = null, tAccelEnd = null, tStop = null
  let vMax = 0, aMax = 0, aMin = 0, xPrev = -1, monotonic = true, negV = false, aViolation = false
  let dragWork = 0, thrustWork = 0, rollWork = 0
  // wheel-slip state: wheels roll until the launch acceleration exceeds what static friction can spin them up to
  const aSlip = p.slipModel ? slipThreshold(p) : Infinity
  let slipping = false, vWheel = 0, slipTime = 0, slipDist = 0, slipStart = null
  let steps = 0
  const maxSteps = Math.ceil(60 / dt) // 60 s hard stop
  const noiseCv = sample.thrustNoiseCv || 0
  const thrustRng = opts.thrustRng

  const rec = (f) => {
    if (trace) trace.push({ t, x, v, a, phase, Ft: f.thrust, Fd: f.drag, Fr: f.roll + f.tether + (f.bearing || 0), slip: slipping })
  }

  while (steps++ < maxSteps) {
    const ts = t - tRelease
    const noise = noiseCv > 0 && thrustRng ? thrustRng.factor(noiseCv) : 1
    let f
    if (phase === 'braking') {
      f = { thrust: 0, drag: 0, roll: 0, tether: 0, net: -p.brakingDecel * p.mEff }
      a = v > 0 ? -p.brakingDecel : 0
    } else {
      f = forces(p, v, ts, noise)
      a = f.net / p.mEff
      if (v <= 0 && a < 0) a = 0 // car at rest cannot be pulled backwards by drag/rolling loss
      if (p.slipModel) {
        if (!slipping && a > aSlip) { slipping = true; if (slipStart === null) slipStart = t }
        if (slipping) {
          // wheels lag the car: kinetic friction retards the body and spins the wheels up; no rolling-resistance term while sliding
          const Fk = p.muK * p.mass * G
          a = (f.thrust - f.drag - f.tether - Fk) / p.mass
          if (v <= 0 && a < 0) a = 0
          vWheel += Math.max(0, (Fk - f.bearing) / Math.max(1e-9, p.kWheel * p.wheelMass)) * dt
          f = { ...f, roll: Fk, net: a * p.mass }
          slipTime += dt; slipDist += v * dt
          if (vWheel >= v + a * dt) { slipping = false; vWheel = v }
        } else vWheel = v
      }
    }
    if (Math.abs(a) > p.aMax) { aViolation = true; a = Math.sign(a) * p.aMax }

    // integrate (semi-implicit Euler)
    const vNew = Math.min(p.vMax, Math.max(0, v + a * dt))
    const xNew = x + vNew * dt
    if (phase !== 'braking' && v > 0 && v + a * dt < -1e-9) negV = true
    if (xNew < x) monotonic = false

    // energy bookkeeping over the timed distance
    if (tFinish === null) {
      thrustWork += f.thrust * vNew * dt
      dragWork += f.drag * vNew * dt
      rollWork += (f.roll + f.tether + (f.bearing || 0)) * vNew * dt
    }

    v = vNew; x = xNew; t += dt
    vMax = Math.max(vMax, v); aMax = Math.max(aMax, a); aMin = Math.min(aMin, a)

    // phase transitions
    if (phase === 'reaction' && t >= tRelease) phase = 'launch'
    if (phase === 'launch' && x >= p.launchZone) { phase = 'acceleration'; tLaunchEnd = t }
    if (phase === 'acceleration' && a < p.highSpeedAccel && x > p.launchZone) { phase = 'highSpeed'; tAccelEnd = t }
    if (tFinish === null && x >= p.trackLength) {
      // interpolate the finish crossing inside the step for timing precision
      const over = x - p.trackLength
      tFinish = t - (v > 0 ? over / v : 0)
      if (tLaunchEnd === null) tLaunchEnd = tFinish
      if (tAccelEnd === null) tAccelEnd = tFinish
      phase = 'braking'
    }
    rec(f)
    if (phase === 'braking' && v <= 0.01) { tStop = t; break }
    if (phase === 'braking' && x >= p.trackLength + p.brakingZone * 3) { tStop = t; break } // far overrun safety
    if (tFinish === null && ts > 8) break // car never reached the finish
  }

  const finished = tFinish !== null
  const overrunDistance = finished ? Math.max(0, x - (p.trackLength + p.brakingZone)) : 0
  const stopDist = finished ? x - p.trackLength : 0
  const brakingTime = finished && tStop !== null ? tStop - tFinish : 0
  const timedRaw = finished ? (inputs.timingMode === 1 ? tStop : tFinish) : inputs.dnfTime
  const penalty = (sample.falseStart ? inputs.falseStartPenalty : 0) + sample.incidents.filter(i => i.key === 'penalty').reduce((s, i) => s + i.magnitude, 0)
  const incidentDelay = sample.incidents.reduce((s, i) => s + (i.key === 'delayedLaunch' || i.key === 'poorReaction' ? i.magnitude : 0), 0)
  const failed = !finished || sample.incidents.some(i => i.key === 'failedRun')
  const timed = failed ? inputs.dnfTime : timedRaw + laneDelay + penalty
  const overrun = overrunDistance > 0

  if (!monotonic) checks.push('Distance decreased during the run')
  if (negV) checks.push('Velocity would have gone negative during forward motion (clamped to 0)')
  if (aViolation) checks.push('Acceleration limit was hit and clamped')
  if (!finished) checks.push('Car did not reach the finish line within 8 s of launch')
  if (overrun) checks.push(`Car overran the braking zone by ${overrunDistance.toFixed(2)} m`)

  // time breakdown of the timed result
  const launchStart = tRelease
  const breakdown = {
    reaction: Math.min(reaction, timedRaw),
    launch: finished ? Math.max(0, tLaunchEnd - launchStart) : 0,
    acceleration: finished ? Math.max(0, tAccelEnd - tLaunchEnd) : 0,
    highSpeed: finished ? Math.max(0, tFinish - tAccelEnd) : 0,
    braking: inputs.timingMode === 1 ? brakingTime : 0,
    launchDelay: Math.min(p.launchDelay, Math.max(0, timedRaw - reaction)),
    incident: incidentDelay,
    penalty,
    lane: laneDelay,
    transition: sample.transition,
  }
  // `launchDelay` is already inside `launch`'s clock window? No: launch begins at tRelease,
  // so the system delay sits between reaction and launch. Keep it as its own line.
  breakdown.launch = Math.max(0, breakdown.launch)

  return {
    driverId: sample.driver?.id || null,
    driverName: sample.driver?.name || '—',
    finished, failed, overrun, overrunDistance, stopDist, brakingTime,
    timed, timedRaw, carTime: finished ? tFinish - reaction : null,
    reaction, launchDelay: p.launchDelay, laneDelay, penalty, falseStart: sample.falseStart,
    incidents: sample.incidents,
    vMax, aMax, aMin, avgSpeed: finished ? p.trackLength / Math.max(1e-6, tFinish - reaction) : 0,
    avgSpeedTimed: finished ? p.trackLength / Math.max(1e-6, timedRaw) : 0,
    tFinish, tStop, transition: sample.transition,
    energy: { thrust: thrustWork, drag: dragWork, roll: rollWork, kinetic: finished ? 0.5 * p.mEff * v * v : 0 },
    dragShare: thrustWork > 0 ? dragWork / thrustWork : 0,
    stoppingMargin: finished ? (p.brakingZone - stopDist) / p.brakingZone : 0,
    slip: { time: slipTime, distance: slipDist, start: slipStart, threshold: aSlip },
    breakdown,
    checks,
    derived: { F0: p.F0, rho: p.rho, mEff: p.mEff, impulse: p.impulse, brakingDecel: p.brakingDecel, predictedStop: stoppingDistance(vMax, p.brakingDecel) },
    trace,
  }
}

/**
 * Simulate a whole race (all runs).
 * @param inputs
 * @param opts { seed, deterministic, recordTrace }
 */
export function simulateRace(inputs, opts = {}) {
  const seed = opts.seed != null ? toSeed(opts.seed) : (inputs.seedMode === 'manual' ? toSeed(inputs.seed) : randomSeed())
  const rng = new RNG(seed)
  const det = !!opts.deterministic
  const runs = []
  const n = Math.max(1, Math.round(inputs.runs))
  let elapsed = 0
  for (let i = 0; i < n; i++) {
    const driver = pickDriver(inputs, i)
    const runRng = rng.child(i)
    const sample = sampleRun(inputs, driver, runRng, { deterministic: det })
    const r = simulateRun(inputs, sample, { recordTrace: !!opts.recordTrace, thrustRng: det ? null : runRng.child(99) })
    r.index = i
    r.startElapsed = elapsed
    elapsed += r.timed + (i < n - 1 ? (det ? inputs.transitionTime : sample.transition) : 0)
    r.endElapsed = elapsed
    runs.push(r)
  }
  return aggregate(inputs, runs, { seed, deterministic: det })
}

function aggregate(inputs, runs, meta) {
  const times = runs.map(r => r.timed)
  const total = times.reduce((s, v) => s + v, 0)
  const mean = total / runs.length
  const sd = runs.length > 1 ? Math.sqrt(runs.reduce((s, r) => s + (r.timed - mean) ** 2, 0) / (runs.length - 1)) : 0
  const sum = k => runs.reduce((s, r) => s + (r.breakdown[k] || 0), 0)
  const breakdown = {
    reaction: sum('reaction'), launchDelay: sum('launchDelay'), launch: sum('launch'), acceleration: sum('acceleration'),
    highSpeed: sum('highSpeed'), braking: sum('braking'), lane: sum('lane'), incident: sum('incident'), penalty: sum('penalty'),
    transition: runs.slice(0, -1).reduce((s, r) => s + r.transition, 0),
  }
  const majorIncident = r => r.failed || r.overrun || r.falseStart || r.incidents.some(i => i.severity !== 'minor')
  const finishedRuns = runs.filter(r => r.finished && !r.failed)
  const completedClean = runs.filter(r => !majorIncident(r)).length
  const checks = [...new Set(runs.flatMap(r => r.checks))]
  if (!(total > 0)) checks.push('Race time is not positive')
  if (!(inputs.mass > 0)) checks.push('Mass must be positive')
  return {
    seed: meta.seed, deterministic: meta.deterministic,
    runs, total, eventTime: runs.length ? runs[runs.length - 1].endElapsed : 0,
    mean, sd, best: Math.min(...times), worst: Math.max(...times),
    consistency: mean > 0 ? 1 - sd / mean : 0,
    reliability: runs.length ? completedClean / runs.length : 0,
    avgSpeed: finishedRuns.length ? finishedRuns.reduce((s, r) => s + r.avgSpeed, 0) / finishedRuns.length : 0,
    vMax: Math.max(0, ...runs.map(r => r.vMax)),
    aMax: Math.max(0, ...runs.map(r => r.aMax)),
    aMin: Math.min(0, ...runs.map(r => r.aMin)),
    meanReaction: runs.reduce((s, r) => s + r.reaction, 0) / runs.length,
    dragShare: finishedRuns.length ? finishedRuns.reduce((s, r) => s + r.dragShare, 0) / finishedRuns.length : 0,
    stoppingMargin: finishedRuns.length ? finishedRuns.reduce((s, r) => s + r.stoppingMargin, 0) / finishedRuns.length : 0,
    slipTime: runs.reduce((s, r) => s + r.slip.time, 0) / runs.length,
    slipDistance: runs.reduce((s, r) => s + r.slip.distance, 0) / runs.length,
    incidents: runs.flatMap(r => r.incidents.map(i => ({ ...i, run: r.index }))),
    anyIncident: runs.some(r => r.incidents.length || r.falseStart || r.overrun),
    anyMajor: runs.some(majorIncident),
    penaltyFree: runs.every(r => r.penalty === 0 && !r.failed),
    penaltyTime: breakdown.penalty,
    incidentTime: breakdown.incident,
    breakdown,
    checks,
    valid: checks.length === 0,
  }
}

/** Deterministic “nominal” race: every random factor at its mean, no incidents. */
export function nominalRace(inputs, recordTrace = false) {
  return simulateRace(inputs, { seed: 0, deterministic: true, recordTrace })
}

export { G }
