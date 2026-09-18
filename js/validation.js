/**
 * VALIDATION · model documentation and sanity checks.
 */
import { INCIDENT_TYPES } from './config.js'

export const EQUATIONS = [
  { name: 'Air density', eq: 'ρ = P / (R_air · T)', note: 'Ideal gas, R_air = 287.05 J·kg⁻¹·K⁻¹, T in kelvin. Overridable by a manual value.' },
  { name: 'Thrust curve', eq: 'F_thr(t) = (I/τ) · η · (1 − L) · k_T · ramp(t) · e^(−t/τ)', note: 'I = cartridge impulse, τ = decay constant, η = launch efficiency, L = mechanical-loss factor, k_T = 1 + c_T·(T − 20 °C). ramp(t) = min(1, t/t_rise). t counts from gas release.' },
  { name: 'Aerodynamic drag', eq: 'F_drag = ½ · ρ · C_d · A · v_rel · |v_rel|', note: 'v_rel = v + v_wind · direction factor (+1 headwind).' },
  { name: 'Downforce', eq: 'F_down = ½ · ρ · C_l · A · v²', note: 'Adds to wheel load. No lift-induced drag term in this version.' },
  { name: 'Rolling resistance', eq: 'F_roll = C_rr · k_surface · k_condition · (m·g + F_down)', note: 'Zero when the car is stationary.' },
  { name: 'Tether friction', eq: 'F_tether = F_t · k_condition', note: 'Constant guide-line friction while moving.' },
  { name: 'Bearing friction', eq: 'F_bearing = 4 · τ_b / r_wheel', note: 'Constant axle-bearing torque converted to a retarding force at the wheel radius.' },
  { name: 'Net force', eq: 'F_net = F_thr − F_drag − F_roll − F_tether − F_bearing', note: 'Longitudinal only. Lateral and pitch dynamics are not simulated.' },
  { name: 'Wheel slip', eq: 'roll while k_w·m_w·a ≤ μ_s·m·g ;  slipping: a = (F_thr − F_drag − F_tether − μ_k·m·g)/m,  v̇_wheel = (μ_k·m·g − F_bearing)/(k_w·m_w)', note: 'At launch the wheels must be spun up by ground friction. If the required force exceeds static friction they slip: kinetic friction retards the body until the wheel rim speed catches the car.' },
  { name: 'Yaw margin', eq: 'M_yaw = x_cp / L_wheelbase × 100 %', note: 'Static aerodynamic yaw stability. Scales the lane-deviation incident probability by 1 + k·(10 % − M_yaw)/10 %, floored at 0.25.' },
  { name: 'Weight distribution', eq: 'rear % = 50 + x_com / L_wheelbase × 100', note: 'x_com positive towards the rear.' },
  { name: 'Time-loss KPIs', eq: 'Δt_X = t_nominal − t_nominal(X = 0)', note: 'Counterfactual nominal simulation with the loss mechanism removed (Cd = 0, Crr = 0, τ_b = 0, F_t = 0, slip off). Reported per run in ms.' },
  { name: 'Effective mass', eq: 'm_eff = m + k_w · m_wheels', note: 'Rotational inertia of the wheels, I = k_w·m·r² per wheel, so Σ I/r² = k_w·m_wheels.' },
  { name: 'Acceleration', eq: 'a = F_net / m_eff', note: 'Clamped to ±a_max as a numerical safety limit; any clamp is reported.' },
  { name: 'Integration', eq: 'v(t+Δt) = v(t) + a·Δt ;  x(t+Δt) = x(t) + v(t+Δt)·Δt', note: 'Semi-implicit (symplectic) Euler with fixed Δt. The finish-line crossing is interpolated inside the step.' },
  { name: 'Braking', eq: 'a = −a_brake (constant) after the finish line ;  d_stop = v² / (2·a_brake)', note: 'Stopping deceleration combines the track stopper and any car brake. Overrun if d_stop > braking-zone length.' },
  { name: 'Run time', eq: 't_run = t_reaction + t_launch-delay + t_car (+ t_brake in full-stop timing) + lane offset + penalties', note: 'Failed runs use the assigned DNF time.' },
  { name: 'Race time', eq: 'T_race = Σ t_run', note: 'Transition time is reported separately as event elapsed time.' },
  { name: 'Consistency', eq: 'C = 1 − σ / μ', note: 'Sample standard deviation and mean of the run times.' },
  { name: 'Overall KPI', eq: 'KPI = Σ w_i · s_i / Σ w_i  (development group)', note: 's_i is each development KPI’s 0–100 score against its team-defined target; w_i are the team’s development weights. Race-outcome indicators are scored but unweighted.' },
]

export const DISTRIBUTIONS = [
  { name: 'Driver reaction time', dist: 'Log-normal(mean, sd) per driver, shifted by strategy', note: 'Right-skewed and strictly positive, like measured reaction data.' },
  { name: 'Cartridge impulse, launch efficiency, Cd, Crr, braking, environment', dist: 'Multiplicative factor 1 + N(0, cv)', note: 'cv values are the “Stochastic variation” inputs. Driver launch/braking consistency scale the launch and braking cv.' },
  { name: 'Lane effect', dist: 'bias + N(0, sd) added to run time', note: '' },
  { name: 'Incidents', dist: 'Bernoulli(p) per run, magnitude ~ Uniform(min, max)', note: 'Probabilities and magnitudes are team inputs.' },
  { name: 'False start', dist: 'Bernoulli(p_fs) with p_fs rising with aggression × risk', note: 'Adds the configured penalty.' },
  { name: 'Transition time', dist: 'N(mean, mean·cv), truncated at 0', note: 'Event time only.' },
]

export const ASSUMPTIONS = [
  'The car moves in one dimension along a straight tethered track. Lateral motion, yaw and pitch are not simulated; lane effects are represented statistically.',
  'Thrust follows a single exponential decay with a short linear rise. Real cartridge curves have a sharper initial spike; the impulse (area) is what the model conserves.',
  'Wheel rolling resistance, bearing friction and tether friction are constant coefficients; speed-dependent bearing losses are folded into Crr.',
  'Wheel slip is modelled as all four wheels slipping together with a single kinetic friction coefficient; the transition back to rolling is instantaneous once the rim speed reaches the car speed.',
  'Yaw stability is a static margin (centre of pressure behind centre of mass). Its only dynamic effect in this version is on the lane-deviation incident probability; yaw-induced drag is not modelled.',
  'Cd and Cl are constant with speed (no Reynolds-number dependence).',
  'Braking is a constant deceleration starting exactly at the finish line.',
  'The driver only affects the start (reaction) and, through consistency multipliers, the scatter of launch and braking. The driver cannot steer a tethered car.',
  'The nine development KPIs are computed from the nominal (deterministic) model, so they describe the car design; the race-outcome indicators describe the simulated race.',
  'Incident probabilities are independent between runs and between incident types.',
  'Default values are starting assumptions for a STEM Racing-class car and must be replaced with the team’s own measurements.',
]

export const LIMITATIONS = [
  'This is a predictive engineering model, not a measurement. All outputs are labelled simulated / predicted and carry the uncertainty of their inputs.',
  'Penalty values, DNF handling and race format (number of runs, timing mode) are configurable because competition regulations change; the defaults are not official rules.',
  'Monte Carlo results describe the model’s uncertainty, not the real event’s. Systematic model error is only revealed by calibration against measured runs.',
  'KPI weights and targets are team-defined and have no relationship to STEM Racing judging criteria.',
  'Wheel spin-up, cartridge cooling during discharge, and track-tether dynamics are not modelled.',
]

/** Sanity checks over inputs and the latest race result. */
export function runChecks(inputs, race) {
  const checks = []
  const add = (label, pass, detail = '') => checks.push({ label, pass, detail })
  add('Mass is positive', inputs.mass > 0, `${inputs.mass} g`)
  add('Track length is positive', inputs.trackLength > 0, `${inputs.trackLength} m`)
  add('Time step is within 0.5–10 ms', inputs.dt >= 0.5 && inputs.dt <= 10, `${inputs.dt} ms`)
  add('Number of runs ≥ 1', inputs.runs >= 1, `${inputs.runs}`)
  const probs = [...Object.values(inputs.incidents).map(i => i.prob), inputs.falseStartProbMax / 100, ...inputs.drivers.map(d => d.errorProb)]
  add('All probabilities within [0, 1]', probs.every(p => p >= 0 && p <= 1), `${probs.length} probabilities checked`)
  add('Incident magnitude ranges are ordered (min ≤ max)', INCIDENT_TYPES.every(t => (inputs.incidents[t.key]?.min ?? 0) <= (inputs.incidents[t.key]?.max ?? 0)))
  add('Driver reaction means are positive', inputs.drivers.every(d => d.reactionMean > 0))
  add('Launch efficiency ≤ 100 %', inputs.launchEfficiency <= 100, `${inputs.launchEfficiency} %`)
  if (race) {
    add('Race time is positive', race.total > 0, `${race.total.toFixed(3)} s`)
    add('Velocity never negative', !race.checks.some(c => c.includes('negative')), '')
    add('Distance increases monotonically in each run', !race.checks.some(c => c.includes('decreased')), '')
    add('Acceleration within configured limit', !race.checks.some(c => c.includes('Acceleration limit')), `|a| ≤ ${inputs.maxAccel} m/s²`)
    add('Every run reached the finish line', race.runs.every(r => r.finished), race.runs.filter(r => !r.finished).length ? `${race.runs.filter(r => !r.finished).length} run(s) did not finish` : '')
    add('Speed below physical limit', race.vMax < inputs.maxSpeed, `${race.vMax.toFixed(2)} m/s vs ${inputs.maxSpeed} m/s`)
    add('Car stopped inside the braking zone', !race.runs.some(r => r.overrun), race.runs.filter(r => r.overrun).length ? `${race.runs.filter(r => r.overrun).length} overrun(s)` : '')
    add('Seed recorded', Number.isFinite(race.seed), `seed ${race.seed}`)
  }
  return checks
}
