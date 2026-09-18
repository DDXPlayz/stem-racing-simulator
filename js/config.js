/**
 * INPUT LAYER · parameter schema and defaults.
 *
 * Every numeric parameter is declared once here with its unit, range and
 * PROVENANCE label. The UI, the validation page and the sensitivity engine
 * all read this schema, so adding a parameter means adding one entry.
 *
 * Provenance kinds:
 *   measured   – a quantity the team enters from measurement (mass, track length)
 *   assumption – a value the team has estimated but not measured
 *   model      – a coefficient of the mathematical model (time-step, thresholds)
 *   random     – a parameter of a probability distribution (sd, probability)
 *   strategy   – a race-strategy decision
 *
 * Default values are STARTING ASSUMPTIONS for a STEM Racing-class car (20 m
 * tethered track, 8 g CO₂ cartridge, ~50 g car). None of them are official
 * competition figures; the team is expected to replace them with its own data.
 */

export const KINDS = {
  measured: { label: 'Measured / team input', short: 'Measured', cls: 'k-measured' },
  assumption: { label: 'Assumption', short: 'Assumed', cls: 'k-assumption' },
  model: { label: 'Model parameter', short: 'Model', cls: 'k-model' },
  random: { label: 'Random / uncertain variable', short: 'Random', cls: 'k-random' },
  strategy: { label: 'Strategy choice', short: 'Strategy', cls: 'k-strategy' },
  calculated: { label: 'Calculated value', short: 'Calculated', cls: 'k-calculated' },
  predicted: { label: 'Predicted output', short: 'Predicted', cls: 'k-predicted' },
}

/** Sections → parameters. `key` is the flat key on the inputs object. */
export const SCHEMA = [
  {
    id: 'car', title: 'Car parameters', hint: 'Mass, wheels and mechanical losses of the physical car.',
    params: [
      { key: 'mass', label: 'Car mass', unit: 'g', default: 52, min: 20, max: 200, step: 0.1, kind: 'measured', hint: 'Total race mass including wheels and cartridge holder, excluding the cartridge.' },
      { key: 'wheelDiameter', label: 'Wheel diameter', unit: 'mm', default: 30, min: 10, max: 80, step: 0.1, kind: 'measured' },
      { key: 'wheelMass', label: 'Total wheel mass (all wheels)', unit: 'g', default: 8, min: 0, max: 60, step: 0.1, kind: 'measured', hint: 'Used for rotational inertia: m_eff = m + Σ I/r² ≈ m + ½·m_wheels for solid discs.' },
      { key: 'wheelInertiaFactor', label: 'Wheel inertia shape factor', unit: '', default: 0.5, min: 0, max: 1, step: 0.05, kind: 'assumption', hint: 'I = k·m·r². 0.5 = solid disc, 1.0 = thin ring. Lighter rims → smaller k.' },
      { key: 'crr', label: 'Wheel rolling resistance coefficient Crr', unit: '', default: 0.008, min: 0, max: 0.2, step: 0.001, kind: 'assumption', hint: 'Wheel–track contact loss only (tyre hysteresis, surface). Bearing friction is a separate input.' },
      { key: 'bearingTorque', label: 'Bearing friction torque (per wheel)', unit: 'N·mm', default: 0.03, min: 0, max: 2, step: 0.005, kind: 'assumption', hint: 'Constant resisting torque of each axle bearing. Retarding force = 4·τ ÷ wheel radius. Measurable with a spin-down test.' },
      { key: 'wheelbase', label: 'Wheelbase', unit: 'mm', default: 110, min: 30, max: 300, step: 0.5, kind: 'measured', hint: 'Front to rear axle. Used for the yaw-stability margin and the weight-distribution KPI.' },
      { key: 'tetherFriction', label: 'Tether-line guide friction', unit: 'N', default: 0.03, min: 0, max: 1, step: 0.005, kind: 'assumption', hint: 'Constant retarding force from the guide line rubbing in the tether guides.' },
      { key: 'mechLoss', label: 'Mechanical-loss factor', unit: '%', default: 3, min: 0, max: 50, step: 0.5, kind: 'assumption', hint: 'Fraction of propulsive force lost to misalignment, leakage around the cartridge seat, etc.' },
      { key: 'comHeight', label: 'Centre-of-mass height', unit: 'mm', default: 18, min: 0, max: 60, step: 0.5, kind: 'measured', hint: 'Recorded for a future pitch/tether-dynamics model. Not used in the longitudinal equations.' },
      { key: 'comOffset', label: 'Centre-of-mass offset from wheelbase centre', unit: 'mm', default: 5, min: -100, max: 100, step: 0.5, kind: 'measured', hint: 'Positive = towards the rear. Rear weight share = 50 % + offset ÷ wheelbase. Drives the weight-distribution KPI.' },
    ],
  },
  {
    id: 'propulsion', title: 'Propulsion & launch', hint: 'CO₂ cartridge thrust curve and launch system behaviour.',
    params: [
      { key: 'impulse', label: 'Cartridge total impulse', unit: 'N·s', default: 1.85, min: 0.1, max: 6, step: 0.01, kind: 'assumption', hint: 'Area under the thrust–time curve. Measurable on a thrust stand; the single most important propulsion number.' },
      { key: 'thrustTau', label: 'Thrust decay time constant τ', unit: 's', default: 0.20, min: 0.02, max: 1.0, step: 0.005, kind: 'assumption', hint: 'F(t) = F₀·e^(−t/τ). Peak thrust F₀ = impulse / τ.' },
      { key: 'thrustRise', label: 'Thrust rise time', unit: 'ms', default: 8, min: 0, max: 100, step: 0.5, kind: 'assumption', hint: 'Time for the thrust to ramp from zero to the curve after gas release.' },
      { key: 'launchDelay', label: 'Launch system delay', unit: 'ms', default: 25, min: 0, max: 300, step: 1, kind: 'assumption', hint: 'Mechanical delay from start signal to gas release (cartridge piercing).' },
      { key: 'launchEfficiency', label: 'Launch efficiency', unit: '%', default: 96, min: 30, max: 100, step: 0.5, kind: 'assumption', hint: 'Fraction of cartridge impulse that becomes forward impulse (alignment, seating, nozzle loss).' },
      { key: 'thrustTempCoeff', label: 'Thrust temperature sensitivity', unit: '%/°C', default: 0.6, min: 0, max: 3, step: 0.05, kind: 'assumption', hint: 'CO₂ vapour pressure rises with temperature; thrust scales by (1 + coeff·(T − 20 °C)).' },
      { key: 'maxSpeed', label: 'Physical speed limit', unit: 'm/s', default: 45, min: 5, max: 100, step: 0.5, kind: 'model', hint: 'Hard cap applied by the integrator as a safety limit; a correct model should never reach it.' },
      { key: 'maxAccel', label: 'Acceleration limit', unit: 'm/s²', default: 400, min: 10, max: 2000, step: 5, kind: 'model', hint: 'Hard cap on |a|. Violations are reported in the validation page.' },
    ],
  },
  {
    id: 'aero', title: 'Aerodynamics', hint: 'Drag and downforce. Air density is computed from the race conditions unless overridden.',
    params: [
      { key: 'cd', label: 'Drag coefficient Cd', unit: '', default: 0.32, min: 0.02, max: 2, step: 0.005, kind: 'assumption', hint: 'From CFD or wind-tunnel test. F_drag = ½·ρ·Cd·A·v².' },
      { key: 'frontalArea', label: 'Frontal area A', unit: 'cm²', default: 22, min: 1, max: 200, step: 0.5, kind: 'measured' },
      { key: 'cl', label: 'Downforce coefficient Cl', unit: '', default: 0.05, min: -1, max: 2, step: 0.005, kind: 'assumption', hint: 'Positive = downforce. Adds to wheel load, so it increases rolling resistance; it also improves the stability margin.' },
      { key: 'cpOffset', label: 'Centre of pressure behind centre of mass', unit: 'mm', default: 12, min: -100, max: 150, step: 0.5, kind: 'assumption', hint: 'From CFD: distance of the aerodynamic centre of pressure aft of the CoM. Positive is yaw-stabilising. Yaw margin = offset ÷ wheelbase.' },
      { key: 'airDensityMode', label: 'Air density', unit: '', default: 0, min: 0, max: 1, step: 1, kind: 'model', type: 'select', options: [{ v: 0, l: 'Computed from temperature & pressure' }, { v: 1, l: 'Manual value' }] },
      { key: 'airDensityManual', label: 'Manual air density ρ', unit: 'kg/m³', default: 1.20, min: 0.8, max: 1.5, step: 0.005, kind: 'measured', showIf: i => i.airDensityMode === 1 },
    ],
  },
  {
    id: 'track', title: 'Track parameters', hint: 'Timed distance, braking zone and surface.',
    params: [
      { key: 'trackLength', label: 'Timed track length', unit: 'm', default: 20, min: 1, max: 100, step: 0.1, kind: 'measured', hint: 'Start line to finish-line timing gate.' },
      { key: 'launchZone', label: 'Launch-zone length', unit: 'm', default: 1.0, min: 0.1, max: 10, step: 0.1, kind: 'model', hint: 'Distance over which the run is classed as the “launch” phase for the time breakdown.' },
      { key: 'brakingZone', label: 'Braking / stopping zone length', unit: 'm', default: 5.0, min: 0.2, max: 30, step: 0.1, kind: 'measured', hint: 'Distance after the finish line available to stop the car.' },
      { key: 'brakingDecel', label: 'Stopping deceleration', unit: 'm/s²', default: 100, min: 5, max: 500, step: 1, kind: 'assumption', hint: 'Mean deceleration from the track stopping system plus any car brake.' },
      { key: 'timingMode', label: 'Timing stops at', unit: '', default: 0, min: 0, max: 1, step: 1, kind: 'model', type: 'select', options: [{ v: 0, l: 'Finish line (STEM Racing format)' }, { v: 1, l: 'Full stop (braking counts in time)' }], hint: 'In the STEM Racing format the clock stops at the finish gate, so braking affects reliability rather than time.' },
      { key: 'surfaceFactor', label: 'Track surface coefficient', unit: '×', default: 1.0, min: 0.5, max: 3, step: 0.05, kind: 'assumption', hint: 'Multiplier on rolling resistance for the actual track surface (1.0 = the surface Crr was measured on).' },
      { key: 'laneBias', label: 'Lane time bias', unit: 'ms', default: 0, min: -200, max: 200, step: 1, kind: 'assumption', hint: 'Systematic time offset of the assigned lane versus the other (tether tension, timing gate alignment).' },
      { key: 'laneVariation', label: 'Lane-to-lane variation (sd)', unit: 'ms', default: 4, min: 0, max: 200, step: 0.5, kind: 'random' },
    ],
  },
  {
    id: 'conditions', title: 'Race conditions', hint: 'Environment on race day.',
    params: [
      { key: 'temperature', label: 'Air temperature', unit: '°C', default: 24, min: -10, max: 50, step: 0.5, kind: 'measured' },
      { key: 'pressure', label: 'Atmospheric pressure', unit: 'hPa', default: 1013, min: 850, max: 1100, step: 1, kind: 'measured' },
      { key: 'windSpeed', label: 'Wind speed (indoor draught)', unit: 'm/s', default: 0, min: 0, max: 15, step: 0.1, kind: 'measured' },
      { key: 'windFactor', label: 'Wind direction factor', unit: '', default: 1, min: -1, max: 1, step: 0.1, kind: 'assumption', hint: '+1 = full headwind, −1 = full tailwind, 0 = crosswind (no longitudinal effect).' },
      { key: 'trackCondition', label: 'Track condition factor', unit: '×', default: 1.0, min: 0.5, max: 2, step: 0.05, kind: 'assumption', hint: 'Dust, humidity or wear on the day. Multiplies rolling resistance and tether friction.' },
      { key: 'surfaceGrip', label: 'Surface grip coefficient μ', unit: '', default: 0.7, min: 0.1, max: 1.5, step: 0.05, kind: 'assumption', hint: 'Static friction coefficient between wheel and track. Sets the launch acceleration above which the wheels cannot spin up fast enough and slip (wheel-slip model).' },
      { key: 'envVariability', label: 'Environmental variability (cv)', unit: '%', default: 1.0, min: 0, max: 20, step: 0.1, kind: 'random', hint: 'Run-to-run random variation in air density and track condition.' },
    ],
  },
  {
    id: 'variation', title: 'Stochastic variation', hint: 'Run-to-run variability of the car and the track. Each is the coefficient of variation (sd ÷ mean) of a multiplicative factor.',
    params: [
      { key: 'thrustCv', label: 'Cartridge impulse variation', unit: '%', default: 2.5, min: 0, max: 30, step: 0.1, kind: 'random', hint: 'Cartridge-to-cartridge fill and temperature scatter.' },
      { key: 'launchCv', label: 'Launch variation', unit: '%', default: 3.0, min: 0, max: 50, step: 0.1, kind: 'random', hint: 'Scatter in launch efficiency and piercing delay. Scaled by the driver’s launch consistency.' },
      { key: 'aeroCv', label: 'Aerodynamic variation', unit: '%', default: 2.0, min: 0, max: 30, step: 0.1, kind: 'random', hint: 'Yaw, vibration and flow unsteadiness changing the effective Cd.' },
      { key: 'rollCv', label: 'Rolling / track variation', unit: '%', default: 4.0, min: 0, max: 50, step: 0.1, kind: 'random' },
      { key: 'brakingCv', label: 'Braking variation', unit: '%', default: 8.0, min: 0, max: 60, step: 0.1, kind: 'random', hint: 'Scaled by the driver’s braking consistency.' },
    ],
  },
  {
    id: 'strategy', title: 'Strategy', hint: 'Race format and the team’s decisions.',
    params: [
      { key: 'runs', label: 'Number of runs (laps)', unit: '', default: 3, min: 1, max: 20, step: 1, kind: 'strategy', hint: 'Each run is one complete pass of the track. The race total is the sum of the run times.' },
      { key: 'transitionTime', label: 'Pit / transition time between runs', unit: 's', default: 45, min: 0, max: 600, step: 1, kind: 'strategy', hint: 'Cartridge change, car return and re-staging. Counted in event elapsed time, not in the timed race total.' },
      { key: 'transitionCv', label: 'Transition time variation', unit: '%', default: 10, min: 0, max: 80, step: 1, kind: 'random' },
      { key: 'strategyMode', label: 'Strategy', unit: '', default: 1, min: 0, max: 2, step: 1, kind: 'strategy', type: 'select', options: [{ v: 0, l: 'Conservative' }, { v: 1, l: 'Balanced' }, { v: 2, l: 'Aggressive' }], hint: 'Aggressive anticipates the start signal: lower mean reaction, higher false-start risk. Conservative waits for a clean signal.' },
      { key: 'riskLevel', label: 'Risk level', unit: '%', default: 50, min: 0, max: 100, step: 5, kind: 'strategy', hint: 'Scales how far the chosen strategy moves reaction time and false-start probability from the balanced baseline.' },
      { key: 'anticipationGain', label: 'Max reaction gain from anticipation', unit: 'ms', default: 60, min: 0, max: 200, step: 5, kind: 'assumption', hint: 'Reaction-time reduction at 100 % aggression.' },
      { key: 'falseStartProbMax', label: 'False-start probability at max aggression', unit: '%', default: 12, min: 0, max: 100, step: 0.5, kind: 'random' },
      { key: 'falseStartPenalty', label: 'False-start penalty', unit: 's', default: 0.5, min: 0, max: 10, step: 0.05, kind: 'assumption', hint: 'Time added to the run for a false start. Set to the value in the current competition regulations.' },
      { key: 'targetTime', label: 'Target race time (total of all runs)', unit: 's', default: 3.30, min: 0.1, max: 600, step: 0.01, kind: 'strategy', hint: 'The time the team wants to beat. Drives the “probability of beating target” output.' },
    ],
  },
  {
    id: 'sim', title: 'Simulation settings', hint: 'Numerical settings of the integrator.',
    params: [
      { key: 'dt', label: 'Time step Δt', unit: 'ms', default: 2, min: 0.5, max: 10, step: 0.5, kind: 'model', hint: 'Semi-implicit Euler step. 1–2 ms resolves the 8 ms thrust rise; 5–10 ms is fine for Monte Carlo.' },
      { key: 'highSpeedAccel', label: 'High-speed phase threshold', unit: 'm/s²', default: 3, min: 0.1, max: 50, step: 0.1, kind: 'model', hint: 'When net acceleration falls below this, the run is classed as in its maximum-speed region.' },
      { key: 'slipModel', label: 'Wheel-slip model', unit: '', default: 1, min: 0, max: 1, step: 1, kind: 'model', type: 'select', options: [{ v: 1, l: 'On – wheels spin up under launch friction' }, { v: 0, l: 'Off – wheels always roll' }], hint: 'While the car accelerates faster than friction can spin the wheels up, kinetic friction acts on the car and the wheels lag. Off assumes perfect traction.' },
      { key: 'slipKineticRatio', label: 'Kinetic ÷ static friction ratio', unit: '', default: 0.8, min: 0.2, max: 1, step: 0.05, kind: 'assumption', hint: 'μ_k = ratio × μ_s while the wheels are slipping.' },
      { key: 'yawCoupling', label: 'Yaw-stability → lane-deviation coupling', unit: '×', default: 1, min: 0, max: 3, step: 0.1, kind: 'model', hint: 'Lane-deviation incident probability is multiplied by 1 + k·(10 % − yaw margin)/10 %. 0 disables the coupling.' },
      { key: 'dnfTime', label: 'Assigned time for a failed run (DNF)', unit: 's', default: 5.0, min: 0.1, max: 60, step: 0.1, kind: 'assumption', hint: 'Placeholder time used so a failed run can still be aggregated. Check the competition rules.' },
    ],
  },
]

/** Default driver profile. Different drivers may have different values. */
export const DRIVER_DEFAULTS = {
  name: 'Driver', reactionMean: 0.180, reactionSd: 0.022, launchConsistency: 1.0, brakingConsistency: 1.0,
  errorProb: 0.02, performanceFactor: 1.0,
}
export const DRIVER_FIELDS = [
  { key: 'reactionMean', label: 'Reaction time (mean)', unit: 's', min: 0.05, max: 1.5, step: 0.001, kind: 'measured', hint: 'Mean of the driver’s measured reaction-time distribution.' },
  { key: 'reactionSd', label: 'Reaction-time variability (sd)', unit: 's', min: 0, max: 0.5, step: 0.001, kind: 'random' },
  { key: 'launchConsistency', label: 'Launch consistency', unit: '×', min: 0.1, max: 3, step: 0.05, kind: 'assumption', hint: 'Multiplies launch variation. 1.0 = nominal, <1 = more consistent.' },
  { key: 'brakingConsistency', label: 'Braking consistency', unit: '×', min: 0.1, max: 3, step: 0.05, kind: 'assumption', hint: 'Multiplies braking variation.' },
  { key: 'errorProb', label: 'Driver error probability (per run)', unit: '', min: 0, max: 1, step: 0.005, kind: 'random', hint: 'Chance of a procedural error adding a “poor reaction” incident.' },
  { key: 'performanceFactor', label: 'Driver performance factor', unit: '×', min: 0.5, max: 1.5, step: 0.01, kind: 'assumption', hint: 'Scales the reaction mean (0.9 = 10 % faster than measured).' },
]

/** Incident model. Probabilities are per run. Impacts are sampled uniformly in [min, max]. */
export const INCIDENT_TYPES = [
  { key: 'delayedLaunch', label: 'Delayed launch', prob: 0.02, min: 0.03, max: 0.15, unit: 's', severity: 'minor', effect: 'Extra delay before gas release.' },
  { key: 'poorReaction', label: 'Poor reaction', prob: 0.03, min: 0.05, max: 0.25, unit: 's', severity: 'minor', effect: 'Reaction time increased.' },
  { key: 'brakingError', label: 'Braking error', prob: 0.01, min: 0.25, max: 0.6, unit: '× decel lost', severity: 'moderate', effect: 'Stopping deceleration reduced; may overrun the braking zone.' },
  { key: 'mechanical', label: 'Minor mechanical variation', prob: 0.02, min: 0.03, max: 0.12, unit: '× thrust lost', severity: 'minor', effect: 'Propulsive force reduced (loose wheel, seating leak).' },
  { key: 'laneDeviation', label: 'Lane deviation / tether rub', prob: 0.02, min: 0.1, max: 0.5, unit: '× drag added', severity: 'minor', effect: 'Drag and tether friction increased for the run.' },
  { key: 'inconsistent', label: 'Inconsistent run', prob: 0.03, min: 0.02, max: 0.06, unit: 'cv', severity: 'minor', effect: 'Extra random noise on thrust and rolling loss.' },
  { key: 'penalty', label: 'Procedural penalty', prob: 0.005, min: 0.1, max: 0.5, unit: 's', severity: 'moderate', effect: 'Fixed time penalty added (check competition rules for the real value).' },
  { key: 'failedRun', label: 'Failed run (DNF)', prob: 0.003, min: 1, max: 1, unit: '', severity: 'major', effect: 'Run not completed; the assigned DNF time is used.' },
]

/**
 * KPI definitions.
 *  group 'development' – the team's nine development factors. Weighted; these
 *                        drive the Overall Performance Index. Weights are the
 *                        team's own decision, not STEM Racing scoring rules.
 *  group 'outcome'     – race-outcome indicators from the simulation. Scored
 *                        against targets but unweighted (informational).
 * Time-loss KPIs (ms) are per run, from counterfactual nominal simulations.
 */
export const KPI_DEFS = [
  { key: 'launch', group: 'development', label: 'Initial thrust / launch efficiency', unit: '%', better: 'higher', target: 95, weight: 24, desc: 'Effective launch efficiency: the share of cartridge impulse that becomes forward impulse (η × (1 − mechanical loss) × temperature factor).' },
  { key: 'drag', group: 'development', label: 'Aerodynamic drag', unit: 'ms', better: 'lower', target: 60, weight: 17, desc: 'Time lost per run to aerodynamic drag: nominal run time minus the same run with Cd = 0.' },
  { key: 'mass', group: 'development', label: 'Car mass', unit: 'g', better: 'lower', target: 50, weight: 17, desc: 'Race mass versus the team target (normally the regulation minimum).' },
  { key: 'wheelFriction', group: 'development', label: 'Wheel friction', unit: 'ms', better: 'lower', target: 5, weight: 10, desc: 'Time lost per run to wheel–track rolling resistance (Crr = 0 counterfactual).' },
  { key: 'bearingFriction', group: 'development', label: 'Bearing friction', unit: 'ms', better: 'lower', target: 5, weight: 9, desc: 'Time lost per run to axle-bearing friction (bearing torque = 0 counterfactual).' },
  { key: 'yaw', group: 'development', label: 'Yaw stability', unit: '%', better: 'higher', target: 10, weight: 8, desc: 'Static yaw margin: centre of pressure behind centre of mass as a percentage of wheelbase. Also scales the lane-deviation incident probability.' },
  { key: 'tether', group: 'development', label: 'Tether friction', unit: 'ms', better: 'lower', target: 10, weight: 6, desc: 'Time lost per run to tether-guide friction (tether friction = 0 counterfactual).' },
  { key: 'slip', group: 'development', label: 'Wheel slip / traction', unit: '', better: 'higher', target: 1.0, weight: 5, desc: 'Traction ratio = friction available to spin the wheels up ÷ friction required at peak launch acceleration, μ_s·m·g ÷ (k·m_wheels·a_peak). Below 1 the wheels slip at launch. The modelled time effect versus perfect traction is reported alongside.' },
  { key: 'com', group: 'development', label: 'Centre of mass / weight distribution', unit: '% rear', better: 'target', target: 55, tol: 15, weight: 4, desc: 'Rear-axle weight share. Scored on closeness to the team target: 100 at the target, 0 at ± tolerance.' },
  { key: 'raceTime', group: 'outcome', label: 'Race time', unit: 's', better: 'lower', target: 3.30, weight: 0, desc: 'Total simulated timed race time versus the team target.' },
  { key: 'speed', group: 'outcome', label: 'Speed', unit: 'm/s', better: 'higher', target: 22.0, weight: 0, desc: 'Average speed over the timed distance versus target.' },
  { key: 'acceleration', group: 'outcome', label: 'Acceleration', unit: 'm/s²', better: 'higher', target: 170, weight: 0, desc: 'Peak launch acceleration versus target.' },
  { key: 'reaction', group: 'outcome', label: 'Reaction', unit: 's', better: 'lower', target: 0.160, weight: 0, desc: 'Mean driver reaction time versus target.' },
  { key: 'consistency', group: 'outcome', label: 'Consistency', unit: '%', better: 'higher', target: 98.5, weight: 0, desc: '1 − σ/μ of the run times.' },
  { key: 'reliability', group: 'outcome', label: 'Reliability', unit: '%', better: 'higher', target: 97, weight: 0, desc: 'Runs completed without a moderate or major incident.' },
  { key: 'braking', group: 'outcome', label: 'Braking', unit: '%', better: 'higher', target: 30, weight: 0, desc: 'Stopping-distance margin as a percentage of the braking zone (and time lost, in full-stop timing).' },
  { key: 'strategy', group: 'outcome', label: 'Strategy', unit: 's', better: 'lower', target: 0, weight: 0, desc: 'Expected time gained (negative) or lost versus the balanced strategy.' },
  { key: 'penalty', group: 'outcome', label: 'Penalty', unit: 's', better: 'lower', target: 0, weight: 0, desc: 'Penalty and incident time in the race total.' },
]

export function defaultInputs() {
  const inputs = {}
  for (const sec of SCHEMA) for (const p of sec.params) inputs[p.key] = p.default
  inputs.drivers = [
    { id: 'd1', ...DRIVER_DEFAULTS, name: 'Driver A' },
    { id: 'd2', ...DRIVER_DEFAULTS, name: 'Driver B', reactionMean: 0.195, reactionSd: 0.018 },
  ]
  inputs.driverAllocation = 'alternate' // 'alternate' | 'best' | driver id | array of ids
  inputs.incidents = Object.fromEntries(INCIDENT_TYPES.map(t => [t.key, { prob: t.prob, min: t.min, max: t.max }]))
  inputs.kpi = {
    targets: Object.fromEntries(KPI_DEFS.map(k => [k.key, k.target])),
    weights: Object.fromEntries(KPI_DEFS.filter(k => k.group === 'development').map(k => [k.key, k.weight])),
  }
  inputs.seedMode = 'random'
  inputs.seed = 20260912
  return inputs
}

export const PARAM_INDEX = new Map()
for (const sec of SCHEMA) for (const p of sec.params) PARAM_INDEX.set(p.key, { ...p, section: sec.id })

export function getParam(key) { return PARAM_INDEX.get(key) || null }

/** Deep-merge a stored inputs object over the defaults (so new parameters get defaults). */
export function mergeInputs(saved) {
  const base = defaultInputs()
  if (!saved || typeof saved !== 'object') return base
  for (const [k, v] of Object.entries(saved)) {
    if (k === 'incidents' && v && typeof v === 'object') {
      for (const [ik, iv] of Object.entries(v)) if (base.incidents[ik]) base.incidents[ik] = { ...base.incidents[ik], ...iv }
    } else if (k === 'kpi' && v && typeof v === 'object') {
      base.kpi.targets = { ...base.kpi.targets, ...(v.targets || {}) }
      base.kpi.weights = { ...base.kpi.weights, ...(v.weights || {}) }
    } else if (k === 'drivers' && Array.isArray(v) && v.length) {
      base.drivers = v.map((d, i) => ({ id: d.id || `d${i + 1}`, ...DRIVER_DEFAULTS, ...d }))
    } else {
      base[k] = v
    }
  }
  return base
}

/** Parameters that the sensitivity engine perturbs by default. */
export const SENSITIVITY_PARAMS = [
  { key: 'mass', label: 'Mass' },
  { key: 'cd', label: 'Drag coefficient Cd' },
  { key: 'frontalArea', label: 'Frontal area' },
  { key: 'crr', label: 'Wheel rolling resistance Crr' },
  { key: 'bearingTorque', label: 'Bearing friction torque' },
  { key: 'surfaceGrip', label: 'Wheel–track grip μ' },
  { key: 'tetherFriction', label: 'Tether friction' },
  { key: 'impulse', label: 'Cartridge impulse' },
  { key: 'thrustTau', label: 'Thrust time constant τ' },
  { key: 'launchEfficiency', label: 'Launch efficiency' },
  { key: 'launchDelay', label: 'Launch system delay' },
  { key: 'mechLoss', label: 'Mechanical loss' },
  { key: 'wheelMass', label: 'Wheel mass' },
  { key: 'brakingDecel', label: 'Braking deceleration' },
  { key: 'reaction', label: 'Reaction time (all drivers)', virtual: true },
]

/** Preset what-if questions. `apply` mutates a copy of the inputs. */
export const WHAT_IF_PRESETS = [
  { id: 'mass-2g', label: 'Car mass decreases by 2 g', apply: i => { i.mass = Math.max(1, i.mass - 2) } },
  { id: 'react-50', label: 'Reaction time improves by 0.05 s', apply: i => { i.drivers.forEach(d => { d.reactionMean = Math.max(0.05, d.reactionMean - 0.05) }) } },
  { id: 'cd-5', label: 'Cd decreases by 5 %', apply: i => { i.cd *= 0.95 } },
  { id: 'brake-10', label: 'Braking improves by 10 %', apply: i => { i.brakingDecel *= 1.10 } },
  { id: 'consist-20', label: 'Consistency improves by 20 %', apply: i => { for (const k of ['thrustCv', 'launchCv', 'aeroCv', 'rollCv', 'brakingCv']) i[k] *= 0.8; i.drivers.forEach(d => { d.reactionSd *= 0.8 }) } },
  { id: 'impulse-5', label: 'Cartridge impulse +5 %', apply: i => { i.impulse *= 1.05 } },
  { id: 'crr-20', label: 'Wheel Crr decreases by 20 %', apply: i => { i.crr *= 0.8 } },
  { id: 'bearing-30', label: 'Bearing friction −30 %', apply: i => { i.bearingTorque *= 0.7 } },
  { id: 'grip-10', label: 'Wheel grip μ +0.1 (less launch slip)', apply: i => { i.surfaceGrip = Math.min(1.5, i.surfaceGrip + 0.1) } },
  { id: 'launch-eff-2', label: 'Launch efficiency +2 points', apply: i => { i.launchEfficiency = Math.min(100, i.launchEfficiency + 2) } },
]
