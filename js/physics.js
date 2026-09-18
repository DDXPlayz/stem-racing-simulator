/**
 * MODEL LAYER · longitudinal physics of a tethered CO₂ car.
 *
 * Everything here is a pure function of (inputs, state). SI units throughout:
 * the UI stores grams, millimetres and cm² for convenience, and `derive()`
 * converts once per simulation.
 *
 * Equations (also listed on the Model page):
 *   ρ       = P / (R_air · T)                       air density, R_air = 287.05 J/(kg·K)
 *   F_thr   = (I/τ) · η_launch · (1 − loss) · k_T · ramp(t) · e^(−t/τ)
 *   F_drag  = ½ · ρ · Cd · A · v_rel²,  v_rel = v + v_wind·dir
 *   F_down  = ½ · ρ · Cl · A · v²
 *   F_roll  = Crr · k_surface · k_cond · (m·g + F_down)
 *   F_teth  = constant guide-line friction · k_cond
 *   F_bear  = 4 · τ_bearing / r_wheel                  axle-bearing friction while moving
 *   F_net   = F_thr − F_drag − F_roll − F_teth − F_bear
 *   Wheel slip: wheels roll while k·m_w·a ≤ μ_s·m·g; otherwise they slip, kinetic
 *   friction μ_k·m·g acts on the car and spins the wheels up (see engine.js).
 *   m_eff   = m + Σ I_wheel / r²  = m + k · m_wheels
 *   a       = F_net / m_eff
 *   v(t+Δt) = v(t) + a·Δt ;  x(t+Δt) = x(t) + v(t+Δt)·Δt   (semi-implicit Euler)
 */

export const G = 9.80665
export const R_AIR = 287.05

export function airDensity(tempC, pressureHpa) {
  return (pressureHpa * 100) / (R_AIR * (tempC + 273.15))
}

/**
 * Convert UI inputs into an SI parameter set for one run. `f` is the bag of
 * multiplicative random factors sampled by the stochastic layer (all 1 for a
 * deterministic run).
 */
export function derive(inputs, f = {}) {
  const F = Object.assign({ thrust: 1, launchEff: 1, aero: 1, roll: 1, braking: 1, env: 1, tether: 1, extraDelay: 0 }, f)
  const mass = inputs.mass / 1000
  const wheelMass = inputs.wheelMass / 1000
  const mEff = mass + inputs.wheelInertiaFactor * wheelMass
  const rho0 = inputs.airDensityMode === 1 ? inputs.airDensityManual : airDensity(inputs.temperature, inputs.pressure)
  const rho = rho0 * F.env
  const area = inputs.frontalArea / 1e4
  const kT = 1 + (inputs.thrustTempCoeff / 100) * (inputs.temperature - 20)
  const eta = (inputs.launchEfficiency / 100) * F.launchEff
  const loss = 1 - inputs.mechLoss / 100
  const tau = inputs.thrustTau
  const F0 = (inputs.impulse * F.thrust / tau) * eta * loss * Math.max(0.2, kT)
  const trackCond = inputs.trackCondition * F.env
  const rWheel = Math.max(1e-3, inputs.wheelDiameter / 2000)
  return {
    mass, mEff, rho, area,
    cd: inputs.cd * F.aero,
    cl: inputs.cl,
    crr: inputs.crr * inputs.surfaceFactor * trackCond * F.roll,
    tether: inputs.tetherFriction * trackCond * F.tether,
    bearing: (4 * (inputs.bearingTorque || 0) / 1000 / rWheel) * F.roll,
    kWheel: inputs.wheelInertiaFactor, wheelMass,
    slipModel: inputs.slipModel !== 0 && wheelMass > 0 && inputs.wheelInertiaFactor > 0,
    muS: inputs.surfaceGrip * trackCond, muK: inputs.surfaceGrip * trackCond * (inputs.slipKineticRatio ?? 0.8),
    F0, tau,
    rise: inputs.thrustRise / 1000,
    launchDelay: inputs.launchDelay / 1000 + F.extraDelay,
    windHead: inputs.windSpeed * inputs.windFactor,
    vMax: inputs.maxSpeed,
    aMax: inputs.maxAccel,
    brakingDecel: inputs.brakingDecel * F.braking,
    trackLength: inputs.trackLength,
    brakingZone: inputs.brakingZone,
    launchZone: inputs.launchZone,
    dt: inputs.dt / 1000,
    highSpeedAccel: inputs.highSpeedAccel,
    impulse: inputs.impulse * F.thrust * eta * loss * Math.max(0.2, kT),
  }
}

/** Thrust at time `ts` since gas release. */
export function thrust(p, ts) {
  if (ts <= 0) return 0
  const ramp = p.rise > 0 ? Math.min(1, ts / p.rise) : 1
  return p.F0 * ramp * Math.exp(-ts / p.tau)
}

export function dragForce(p, v) {
  const vRel = v + p.windHead
  return 0.5 * p.rho * p.cd * p.area * vRel * Math.abs(vRel)
}

export function downforce(p, v) {
  return 0.5 * p.rho * p.cl * p.area * v * v
}

export function rollingForce(p, v) {
  const load = p.mass * G + downforce(p, v)
  return v > 0 ? p.crr * Math.max(0, load) : 0
}

export function tetherForce(p, v) {
  return v > 0 ? p.tether : 0
}

export function bearingForce(p, v) {
  return v > 0 ? p.bearing : 0
}

/** Launch acceleration above which the wheels cannot be spun up by static friction. */
export function slipThreshold(p) {
  return (p.muS * p.mass * G) / Math.max(1e-9, p.kWheel * p.wheelMass)
}

/** All longitudinal forces for a state. */
export function forces(p, v, ts, thrustNoise = 1) {
  const Ft = thrust(p, ts) * thrustNoise
  const Fd = dragForce(p, v)
  const Fr = rollingForce(p, v)
  const Fg = tetherForce(p, v)
  const Fb = bearingForce(p, v)
  return { thrust: Ft, drag: Fd, roll: Fr, tether: Fg, bearing: Fb, net: Ft - Fd - Fr - Fg - Fb }
}

/** Stopping distance for speed v under constant deceleration. */
export function stoppingDistance(v, decel) {
  return decel > 0 ? (v * v) / (2 * decel) : Infinity
}

