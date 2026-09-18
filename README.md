# Anantam Racing — STEM Racing Race Simulator & KPI Engine

A standalone engineering-analysis subsite for Team Anantam. It takes the team's
car, driver, track and strategy data, simulates a complete STEM Racing event
with a time-step physics model, and converts the simulated race into KPIs,
probabilities and engineering insight.

```
INPUT DATA → MATHEMATICAL MODEL → FULL RACE SIMULATION → MONTE CARLO → KPI ANALYSIS → ENGINEERING INSIGHT
```

Reachable at `https://anantamracing.com/race-simulator/`. Like the carbon
calculator, it is **intentionally unlinked** from the main site and carries
`noindex, nofollow` until the model has been calibrated against real test data.
Remove the `robots` meta tag in `index.html` (and add the URL to the root
`sitemap.xml`) when it should be public.

## What it does

| View | Purpose |
| --- | --- |
| Dashboard | Current-model headline numbers, the five questions, big SIMULATE RACE button |
| Race inputs | Car, propulsion, aero, track, conditions, variation, strategy, drivers, incidents, seed, simulation settings — every value labelled by provenance |
| Simulate | Animated time-step race with live status, telemetry, phase strip, incident feed, then the full FINAL RESULT and time breakdown |
| Live telemetry | Speed / position / acceleration / forces vs time, run times, speed vs distance (hover for values) |
| Race replay | Track view, phase timeline, play / pause / restart / ×0.1–×5 / scrub, live telemetry |
| KPI analysis | Nine team-defined **development KPIs** (weighted into the Overall Performance Index) plus unweighted race-outcome indicators, each with “How was this calculated?” |
| Monte Carlo | 100 / 500 / 1,000 / 5,000 / custom simulations: mean, median, best/worst, σ, P5/P25/P75/P95, P(beat target), P(incident), P(penalty-free) |
| Sensitivity | Controlled ±2/5/10 % perturbation of every key parameter; ranked table + tornado chart |
| What if? | Preset and custom single-variable changes: baseline vs modified time, time saved, %, KPI change, P(beat target) |
| Scenario comparison | Save named scenarios (with a 500-run Monte Carlo summary) and compare side by side |
| Model / assumptions | Equations, distributions, assumptions, limitations, provenance of every parameter, sanity checks, seed / Δt / N |
| Calibration | Import measured `time, distance, velocity, acceleration, run_number` CSV, compare measured vs simulated, fit Cd / Crr / impulse / τ / launch / braking parameters, apply |

## Development KPIs

The Overall Performance Index is the weighted mean of these nine team-defined
factors (weights editable in the KPI view). They are computed from the nominal
model, so they describe the car design; time-loss KPIs come from counterfactual
simulations (nominal run minus the same run with that loss removed).

| Development KPI | Weight | Model quantity |
| --- | ---: | --- |
| Initial thrust / launch efficiency | 24 % | Effective launch efficiency η·(1−loss)·k_T, with peak thrust and launch time |
| Aerodynamic drag | 17 % | ms lost per run vs Cd = 0 |
| Car mass | 17 % | Race mass vs target |
| Wheel friction | 10 % | ms lost per run vs Crr = 0 |
| Bearing friction | 9 % | ms lost per run vs zero bearing torque |
| Yaw stability | 8 % | Static yaw margin (CP aft of CoM ÷ wheelbase); scales lane-deviation risk |
| Tether friction | 6 % | ms lost per run vs zero tether friction |
| Wheel slip / traction | 5 % | ms lost per run vs perfect traction, with traction ratio μ_s·m·g ÷ (k·m_w·a_peak) |
| Centre of mass / weight distribution | 4 % | Rear weight share vs target (closeness score) |

Race-outcome indicators (race time, speed, acceleration, reaction, consistency,
reliability, braking, strategy, penalty) are scored against targets but carry
no weight.

## Model (summary)

Longitudinal 1-D model of a tethered CO₂ car, semi-implicit Euler at a fixed
Δt (default 2 ms):

```
ρ      = P / (R_air·T)
F_thr  = (I/τ)·η·(1−L)·k_T·ramp(t)·e^(−t/τ)
F_drag = ½·ρ·Cd·A·v_rel²          F_roll = Crr·k_s·k_c·(m·g + F_down)
F_bear = 4·τ_b / r_wheel
F_net  = F_thr − F_drag − F_roll − F_tether − F_bear
a      = F_net / m_eff,  m_eff = m + k_w·m_wheels
wheel slip while k_w·m_w·a > μ_s·m·g: kinetic friction μ_k·m·g on the body, wheels spin up
```

Phases per run: reaction → launch → acceleration → max-speed region → braking
(→ transition). Race = N runs; timed total = Σ run times (finish-line timing by
default, full-stop timing optional). Stochastic layer: log-normal reaction
times, multiplicative 1 + N(0, cv) factors on impulse / launch / Cd / Crr /
braking / environment, lane bias, per-run Bernoulli incidents with uniform
magnitudes, strategy-dependent false-start risk. Every race is driven by a
seeded PRNG (sfc32) so any result can be reproduced from its seed.

**Nothing is presented as a measured result.** Default values are starting
assumptions for a STEM Racing-class car (20 m track, 8 g cartridge, ~50 g car),
not official figures. KPI weights and targets are team-defined, not scoring
rules.

## Files

| File | Layer | Purpose |
| --- | --- | --- |
| `index.html` | Presentation | Page shell, header, side navigation, footer |
| `styles.css` | Presentation | Dark telemetry theme matching the main site |
| `js/config.js` | Input | Parameter schema with units, ranges, provenance kinds; defaults; incident types; KPI definitions; what-if presets |
| `js/physics.js` | Model | Air density, thrust curve, drag, downforce, rolling, tether; SI conversion |
| `js/rng.js` | Stochastic | Seeded sfc32 PRNG, normal / log-normal / truncated samplers |
| `js/stochastic.js` | Stochastic | Per-run sampling of variability, reaction time, strategy effect, incidents |
| `js/engine.js` | Engine | Time-step run and race simulation, phases, time breakdown, sanity flags |
| `js/kpi.js` | KPI | Nine weighted development KPIs (counterfactual time losses, yaw margin, traction, weight distribution) + outcome indicators |
| `js/analysis.js` | Analysis | Statistics, chunked Monte Carlo, perturbation sensitivity, what-if |
| `js/calibration.js` | Analysis | CSV parsing, measured-vs-simulated comparison, coordinate-descent fit |
| `js/validation.js` | Analysis | Equations, distributions, assumptions, limitations, sanity checks |
| `js/charts.js` | Presentation | Dependency-free SVG line / bar / histogram / tornado / KPI charts |
| `js/replay.js` | Presentation | Track SVG, phase timeline, replay controller |
| `js/storage.js` | Presentation | localStorage persistence, export / import, scenarios |
| `js/app.js` | Presentation | Views, routing, events |

The model layers (`config`, `physics`, `rng`, `stochastic`, `engine`, `kpi`,
`analysis`, `calibration`, `validation`) have no DOM dependency and run in Node:

```bash
node -e "import('./js/engine.js').then(async e => { const c = await import('./js/config.js'); console.log(e.nominalRace(c.defaultInputs()).total) })"
```

## Isolation

- No build step and no dependencies. Plain HTML, CSS and ES modules; Google
  Fonts are the only external resource.
- Own stylesheet and favicon copies; nothing imported from the root site.
- Deleting this folder removes the tool entirely and changes nothing else.

## Preview locally

ES modules need an HTTP server (opening `index.html` from disk will not work).

```bash
cd race-simulator && python3 -m http.server 4323
```

Then open <http://localhost:4323/>.

## Calibration workflow

1. Record test runs with a timing/telemetry rig and export
   `time, distance, velocity, acceleration, run_number` (blank cells allowed).
2. Calibration → paste or upload the CSV → Compare. Check the RMSE and error
   plots.
3. Tick the parameters to fit → Fit parameters → Apply to inputs.
4. Re-run Monte Carlo. The simulator is now a closer digital twin of the car;
   repeat as the car evolves.
