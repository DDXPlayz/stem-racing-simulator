/**
 * PRESENTATION LAYER · renders the twelve views from one state object and
 * delegates all events from #app. No framework, no build step.
 *
 *   INPUT → MODEL → STOCHASTIC → ENGINE → KPI → ANALYSIS → (this file)
 */
import { SCHEMA, KINDS, DRIVER_DEFAULTS, DRIVER_FIELDS, INCIDENT_TYPES, KPI_DEFS, SENSITIVITY_PARAMS, WHAT_IF_PRESETS, defaultInputs, getParam } from './config.js'
import { simulateRace, nominalRace, PHASE_LABEL } from './engine.js'
import { computeKPIs, fmtKPI } from './kpi.js'
import { runMonteCarlo, sensitivity, whatIf, mcAsRace, stats, clone } from './analysis.js'
import { parseCSV, groupRuns, compare, calibrate, CALIBRATABLE } from './calibration.js'
import { EQUATIONS, DISTRIBUTIONS, ASSUMPTIONS, LIMITATIONS, runChecks } from './validation.js'
import { airDensity } from './physics.js'
import { randomSeed } from './rng.js'
import * as store from './storage.js'
import { lineChart, barChart, histogramChart, tornadoChart, kpiChart, COLORS } from './charts.js'
import { trackSVG, timelineHTML, phaseSegments, sampleTrace, Replayer, PHASE_COLORS } from './replay.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—')
const pct = (v, d = 1) => (Number.isFinite(v) ? (v * 100).toFixed(d) + ' %' : '—')
const sign = (v, d = 3) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '—')
const tag = kind => `<span class="tag ${KINDS[kind].cls}" title="${KINDS[kind].label}">${KINDS[kind].short}</span>`

const VIEWS = ['dashboard', 'inputs', 'simulate', 'telemetry', 'replay', 'kpi', 'montecarlo', 'sensitivity', 'whatif', 'scenarios', 'model', 'calibration']

/* ------------------------------------------------------------------ */
/* state                                                              */
/* ------------------------------------------------------------------ */
const state = store.load()
let rev = 1                       // increments on every input change; results carry the rev they were computed at
let view = viewFromHash()
let nominal = null                // deterministic race with traces
let lastRace = null               // last stochastic race with traces
let lastMC = null
let lastSens = null
let lastWhatIf = null
let whatIfSel = { type: 'preset', id: WHAT_IF_PRESETS[0].id, key: 'mass', value: null }
let sim = { running: false, raf: null, slowmo: 0.25 }
let replayer = null
let replayRun = 0
let mc = { running: false, progress: 0, n: state.prefs.mcN || 1000, baseSeed: 1, abort: null }
let calib = { runs: null, cmp: null, result: null, keys: ['cd', 'crr', 'impulse', 'thrustTau'], align: 'motion', error: null }
let scenarioSel = new Set()
let busy = null

const app = $('#app')

function viewFromHash() { const h = location.hash.replace('#', ''); return VIEWS.includes(h) ? h : 'dashboard' }
function go(v) { view = v; if (location.hash !== '#' + v) history.pushState(null, '', '#' + v); render(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
window.addEventListener('hashchange', () => { const v = viewFromHash(); if (v === view) return; view = v; render(); window.scrollTo({ top: 0 }) })

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600) }
function setStatus(text, mode = '') { const p = $('#status-pill'); p.className = 'status-pill ' + mode; $('#status-text').textContent = text }

function getNominal() {
  if (!nominal || nominal.rev !== rev) { nominal = nominalRace(state.inputs, true); nominal.rev = rev }
  return nominal
}
function isStale(r) { return r && r.rev !== rev }
function invalidate() { rev++; nominal = null }
function persist() { store.save(state) }

/* ------------------------------------------------------------------ */
/* shared fragments                                                   */
/* ------------------------------------------------------------------ */

function head(kicker, title, lede, right = '') {
  return `<div class="view-head"><div><div class="kicker">${kicker}</div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div><div class="btn-row">${right}</div></div>`
}
function stat(lbl, val, unit, sub = '', cls = '', kind = 'predicted') {
  return `<div class="stat ${cls}"><div class="lbl">${lbl}</div><div class="val">${val}${unit ? `<small>${unit}</small>` : ''}</div>${sub ? `<div class="sub">${sub}</div>` : ''}${kind ? `<span class="tag ${KINDS[kind].cls}">${KINDS[kind].short}</span>` : ''}</div>`
}
function staleNote(r, what) {
  return isStale(r) ? `<div class="note">Inputs have changed since this ${what} was computed. Re-run it to refresh.</div>` : ''
}
function kindsLegend() {
  return `<div class="legend-kinds"><span class="ui-sm">Provenance:</span>${Object.keys(KINDS).map(k => `<span class="tag ${KINDS[k].cls}">${KINDS[k].label}</span>`).join('')}</div>`
}

/** Time-breakdown bars for a race (or run) breakdown object. */
function breakdownHTML(b, total, { includeTransition = false } = {}) {
  const rows = [
    ['Reaction', b.reaction], ['Launch-system delay', b.launchDelay], ['Launch (to end of launch zone)', b.launch], ['Acceleration', b.acceleration],
    ['Max-speed region', b.highSpeed], ['Braking (timed)', b.braking], ['Lane effect', b.lane], ['Incident delay', b.incident], ['Penalty', b.penalty],
  ]
  const max = Math.max(1e-9, ...rows.map(r => Math.abs(r[1])))
  let html = rows.map(([l, v]) => `<div class="row"><div class="lbl">${l}</div><div class="bar"><i style="width:${(Math.abs(v) / max) * 100}%"></i></div><div class="v">${f(v)} s</div></div>`).join('')
  html += `<div class="row total"><div class="lbl">Timed total</div><div></div><div class="v">${f(total)} s</div></div>`
  if (includeTransition) html += `<div class="row"><div class="lbl muted">Transition (event time only)</div><div></div><div class="v muted">${f(b.transition, 1)} s</div></div>`
  return `<div class="breakdown">${html}</div>`
}

function incidentsHTML(race) {
  const items = []
  for (const r of race.runs) {
    if (r.falseStart) items.push({ run: r.index, cls: 'major', text: `False start · +${f(state.inputs.falseStartPenalty)} s penalty` })
    for (const i of r.incidents) items.push({ run: r.index, cls: i.severity === 'minor' ? '' : 'major', text: `${i.label} · ${i.unit === 's' ? f(i.magnitude) + ' s' : i.unit === '' ? '' : (i.magnitude * (i.unit.startsWith('×') ? 100 : 1)).toFixed(i.unit.startsWith('×') ? 0 : 2) + (i.unit.startsWith('×') ? ' %' : ' ' + i.unit)}` })
    if (r.overrun) items.push({ run: r.index, cls: 'major', text: `Braking-zone overrun by ${f(r.overrunDistance, 2)} m` })
  }
  if (!items.length) return `<div class="incident ok"><span class="t">—</span>No incidents in this race</div>`
  return items.map(i => `<div class="incident ${i.cls}"><span class="t">Run ${i.run + 1}</span>${esc(i.text)}</div>`).join('')
}

/* ------------------------------------------------------------------ */
/* render dispatcher                                                  */
/* ------------------------------------------------------------------ */
const RENDER = {}
function render() {
  stopAnimations()
  $$('#sidenav a').forEach(a => a.toggleAttribute('aria-current', a.dataset.view === view) || (a.dataset.view === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')))
  app.innerHTML = RENDER[view]?.() || ''
  AFTER[view]?.()
}
const AFTER = {}
function stopAnimations() {
  if (sim.raf) cancelAnimationFrame(sim.raf); sim.raf = null; sim.running = false
  if (replayer) { replayer.destroy(); replayer = null }
}

/* ------------------------------------------------------------------ */
/* 01 dashboard                                                       */
/* ------------------------------------------------------------------ */
RENDER.dashboard = () => {
  const nom = getNominal()
  const i = state.inputs
  const kpiSrc = lastMC && !isStale(lastMC) ? computeKPIs(mcAsRace(lastMC, i), i, { mc: lastMC }) : computeKPIs(lastRace && !isStale(lastRace) ? lastRace : nom, i)
  const cons = lastMC && !isStale(lastMC) ? lastMC.meanConsistency : lastRace && !isStale(lastRace) ? lastRace.consistency : null
  const rel = lastMC && !isStale(lastMC) ? lastMC.meanReliability : lastRace && !isStale(lastRace) ? lastRace.reliability : null
  const basis = lastMC && !isStale(lastMC) ? `Monte Carlo · ${lastMC.n} simulations` : lastRace && !isStale(lastRace) ? `Last simulated race · seed ${lastRace.seed}` : 'Nominal model (no variability)'
  const q = []
  q.push(['How fast can our car theoretically be?', `Nominal model: <span class="v">${f(nom.total)} s</span> for ${i.runs} run(s), ${f(nom.runs[0].carTime)} s car time per run at ${f(nom.vMax, 1)} m/s peak.`])
  q.push(['How fast are we likely to be?', lastMC && !isStale(lastMC) ? `Median <span class="v">${f(lastMC.stats.median)} s</span>, 90 % of simulations between ${f(lastMC.stats.p5)} and ${f(lastMC.stats.p95)} s.` : 'Run a Monte Carlo analysis to find out.'])
  q.push(['What is causing us to lose time?', `Reaction ${f(nom.breakdown.reaction)} s, launch ${f(nom.breakdown.launchDelay + nom.breakdown.launch)} s, acceleration ${f(nom.breakdown.acceleration)} s, max-speed region ${f(nom.breakdown.highSpeed)} s${nom.breakdown.braking ? `, braking ${f(nom.breakdown.braking)} s` : ''}.`])
  q.push(['Which improvement matters most?', lastSens && !isStale(lastSens) ? `Highest sensitivity: <span class="v">${esc(lastSens.rows[0].label)}</span> (elasticity ${f(lastSens.rows[0].elasticity, 2)}), then ${esc(lastSens.rows[1]?.label || '')}.` : 'Run the sensitivity analysis to rank the parameters.'])
  q.push(['How confident are we?', lastMC && !isStale(lastMC) ? `P(beat ${f(i.targetTime, 2)} s target) = <span class="v">${pct(lastMC.pBeatTarget)}</span>; P(penalty-free race) = ${pct(lastMC.pPenaltyFree)}.` : 'Monte Carlo gives the probability of beating the target.'])
  return `
    ${head('Dashboard', 'Current model', 'Predicted values from the team-configured model. Nothing here is a measured race result.', `<button class="btn btn-ghost btn-sm" data-goto="inputs">Edit inputs</button>`)}
    <div class="dash-hero">
      <div class="panel red">
        <div class="panel-head"><div><div class="kicker">Current model</div><div class="small muted">Basis: ${basis}</div></div>${kindsLegend()}</div>
        <div class="grid grid-3">
          ${stat('Predicted race time', f(nom.total), 's', `${i.runs} run(s) · nominal`, 'hero')}
          ${stat('Average speed', f(nom.avgSpeed, 2), 'm/s', 'release → finish gate')}
          ${stat('Maximum speed', f(nom.vMax, 2), 'm/s', `peak accel ${f(nom.aMax, 0)} m/s²`)}
          ${stat('Consistency', cons == null ? '--.--' : (cons * 100).toFixed(2), '%', cons == null ? 'needs a stochastic run' : '1 − σ/μ of run times')}
          ${stat('Reliability', rel == null ? '--.--' : (rel * 100).toFixed(2), '%', rel == null ? 'needs a stochastic run' : 'clean runs')}
          ${stat('Overall KPI', kpiSrc.overall.toFixed(1), '/100', '9 development factors · team weights', '', 'calculated')}
        </div>
        <div style="margin-top:22px">
          <button class="btn btn-primary btn-xl" data-action="simulate">Simulate race</button>
          <div class="btn-row" style="margin-top:12px;justify-content:center">
            <button class="btn btn-ghost btn-sm" data-goto="montecarlo">Monte Carlo</button>
            <button class="btn btn-ghost btn-sm" data-goto="sensitivity">Sensitivity</button>
            <button class="btn btn-ghost btn-sm" data-goto="whatif">What if?</button>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><div class="kicker">Nominal time breakdown</div><h3>Where the time goes</h3></div>${tag('calculated')}</div>
        ${breakdownHTML(nom.breakdown, nom.total, { includeTransition: true })}
        <p class="small muted" style="margin-top:12px">Deterministic run with every random variable at its mean and no incidents. Seeded stochastic races add variability on top.</p>
      </div>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="panel-head"><div><div class="kicker">Five questions</div><h3>What the simulator answers</h3></div></div>
      <div class="questions">${q.map(([t, a], k) => `<div class="q"><div class="n">0${k + 1}</div><div><strong>${t}</strong></div><div class="a">${a}</div></div>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><div class="kicker">Architecture</div><h3>Data flow</h3></div></div>
      <div class="flow"><span>Input layer</span><b>→</b><span>Model layer (physics)</span><b>→</b><span>Stochastic layer</span><b>→</b><span>Time-step engine · Δt ${i.dt} ms</span><b>→</b><span>KPI engine</span><b>→</b><span>Analysis (Monte Carlo · sensitivity)</span><b>→</b><span>Presentation</span></div>
      ${lastRace ? `<p class="small muted" style="margin-top:12px">Last simulated race: ${f(lastRace.total)} s · seed ${lastRace.seed}${isStale(lastRace) ? ' · inputs changed since' : ''}. <button class="btn-link" data-goto="telemetry">Telemetry</button> · <button class="btn-link" data-goto="replay">Replay</button></p>` : ''}
    </div>`
}

/* ------------------------------------------------------------------ */
/* 02 inputs                                                          */
/* ------------------------------------------------------------------ */
function fieldHTML(p, value, attrs = '') {
  const lbl = `<label for="f-${p.key}"><span>${esc(p.label)}</span>${tag(p.kind)}</label>`
  if (p.type === 'select') {
    return `<div class="field">${lbl}<div class="with-unit"><select id="f-${p.key}" ${attrs}>${p.options.map(o => `<option value="${o.v}" ${o.v === value ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ''}</div>`
  }
  return `<div class="field">${lbl}<div class="with-unit"><input type="number" id="f-${p.key}" value="${value}" min="${p.min}" max="${p.max}" step="${p.step}" ${attrs} />${p.unit ? `<span class="unit">${esc(p.unit)}</span>` : ''}</div>${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ''}</div>`
}

RENDER.inputs = () => {
  const i = state.inputs
  const sections = SCHEMA.map(sec => `
    <section class="panel" id="sec-${sec.id}">
      <div class="panel-head"><div><div class="kicker">${esc(sec.title)}</div><div class="hint">${esc(sec.hint)}</div></div></div>
      <div class="fields">${sec.params.filter(p => !p.showIf || p.showIf(i)).map(p => fieldHTML(p, i[p.key], `data-key="${p.key}"`)).join('')}</div>
      ${sec.id === 'aero' ? `<p class="small muted" style="margin-top:12px">Computed air density at ${i.temperature} °C and ${i.pressure} hPa: <code>${airDensity(i.temperature, i.pressure).toFixed(4)} kg/m³</code> ${tag('calculated')}</p>` : ''}
      ${sec.id === 'propulsion' ? `<p class="small muted" style="margin-top:12px">Derived peak thrust F₀ = I/τ × η × (1 − loss) × k_T = <code>${getNominal().runs[0].derived.F0.toFixed(2)} N</code>, effective impulse <code>${getNominal().runs[0].derived.impulse.toFixed(3)} N·s</code> ${tag('calculated')}</p>` : ''}
    </section>`).join('')

  const drivers = `
    <section class="panel" id="sec-drivers">
      <div class="panel-head"><div><div class="kicker">Driver parameters</div><div class="hint">Each driver has their own reaction-time distribution and consistency profile. In STEM Racing the driver releases the car; reaction time is the dominant human factor.</div></div>
        <button class="btn btn-ghost btn-sm" data-action="add-driver">Add driver</button></div>
      <div class="grid grid-2">${i.drivers.map(d => `
        <div class="driver-card" data-driver-card="${d.id}">
          <div class="head"><input class="name" value="${esc(d.name)}" data-driver="${d.id}" data-field="name" aria-label="Driver name" />${i.drivers.length > 1 ? `<button class="btn btn-ghost btn-sm" data-action="remove-driver" data-id="${d.id}">Remove</button>` : ''}</div>
          <div class="fields">${DRIVER_FIELDS.map(fd => `<div class="field"><label><span>${esc(fd.label)}</span>${tag(fd.kind)}</label><div class="with-unit"><input type="number" value="${d[fd.key]}" min="${fd.min}" max="${fd.max}" step="${fd.step}" data-driver="${d.id}" data-field="${fd.key}" />${fd.unit ? `<span class="unit">${fd.unit}</span>` : ''}</div>${fd.hint ? `<div class="hint">${esc(fd.hint)}</div>` : ''}</div>`).join('')}</div>
        </div>`).join('')}
      </div>
      <div class="fields" style="margin-top:16px">
        <div class="field"><label><span>Driver allocation across runs</span>${tag('strategy')}</label><div class="with-unit"><select data-key="driverAllocation" data-type="string">
          <option value="alternate" ${i.driverAllocation === 'alternate' ? 'selected' : ''}>Alternate drivers each run</option>
          <option value="best" ${i.driverAllocation === 'best' ? 'selected' : ''}>Fastest driver for every run</option>
          ${i.drivers.map(d => `<option value="${d.id}" ${i.driverAllocation === d.id ? 'selected' : ''}>${esc(d.name)} for every run</option>`).join('')}
        </select></div></div>
      </div>
    </section>`

  const incidents = `
    <section class="panel" id="sec-incidents">
      <div class="panel-head"><div><div class="kicker">Race incidents</div><div class="hint">Probability per run and the range of the effect. Keep probabilities realistic: the defaults give roughly one minor incident in every three three-run races.</div></div>${tag('random')}</div>
      <div class="table-wrap"><table><thead><tr><th>Incident</th><th>Severity</th><th>Effect</th><th class="num">Probability / run</th><th class="num">Min effect</th><th class="num">Max effect</th><th>Unit</th></tr></thead><tbody>
        ${INCIDENT_TYPES.map(t => { const c = i.incidents[t.key]; return `<tr><td><strong>${esc(t.label)}</strong></td><td><span class="rating ${t.severity === 'major' ? 'High' : t.severity === 'moderate' ? 'Medium' : 'Low'}">${t.severity}</span></td><td class="small muted">${esc(t.effect)}</td>
          <td class="num"><input type="number" class="mono" style="width:7ch;background:var(--black);border:1px solid var(--line-strong);border-radius:4px;padding:4px 6px;color:#fff" value="${c.prob}" min="0" max="1" step="0.001" data-inc="${t.key}" data-field="prob" /></td>
          <td class="num"><input type="number" class="mono" style="width:7ch;background:var(--black);border:1px solid var(--line-strong);border-radius:4px;padding:4px 6px;color:#fff" value="${c.min}" min="0" step="0.01" data-inc="${t.key}" data-field="min" ${t.key === 'failedRun' ? 'disabled' : ''} /></td>
          <td class="num"><input type="number" class="mono" style="width:7ch;background:var(--black);border:1px solid var(--line-strong);border-radius:4px;padding:4px 6px;color:#fff" value="${c.max}" min="0" step="0.01" data-inc="${t.key}" data-field="max" ${t.key === 'failedRun' ? 'disabled' : ''} /></td>
          <td class="small muted">${esc(t.unit || '—')}</td></tr>` }).join('')}
      </tbody></table></div>
    </section>`

  const seed = `
    <section class="panel" id="sec-seed">
      <div class="panel-head"><div><div class="kicker">Random seed</div><div class="hint">A manual seed reproduces a race exactly. Random picks a fresh seed for each simulation; the seed used is always reported.</div></div>${tag('model')}</div>
      <div class="fields">
        <div class="field"><label><span>Seed mode</span></label><div class="with-unit"><select data-key="seedMode" data-type="string"><option value="random" ${i.seedMode === 'random' ? 'selected' : ''}>Random</option><option value="manual" ${i.seedMode === 'manual' ? 'selected' : ''}>Manual seed</option></select></div></div>
        <div class="field"><label><span>Manual seed</span></label><div class="with-unit"><input type="number" value="${i.seed}" step="1" min="0" data-key="seed" ${i.seedMode === 'manual' ? '' : 'disabled'} /></div></div>
      </div>
    </section>`

  const nom = getNominal()
  return `
    ${head('Race inputs', 'Team data & model parameters', 'Every value is labelled by provenance. Measured values should come from the team’s own testing; assumptions are placeholders until calibrated.', `<button class="btn btn-primary btn-sm" data-action="simulate">Simulate race</button>`)}
    ${kindsLegend()}
    <div class="inputs-toc" style="margin-top:14px">${SCHEMA.map(s => `<a href="#sec-${s.id}" data-scroll="sec-${s.id}">${esc(s.title)}</a>`).join('')}<a href="#sec-drivers" data-scroll="sec-drivers">Drivers</a><a href="#sec-incidents" data-scroll="sec-incidents">Incidents</a><a href="#sec-seed" data-scroll="sec-seed">Seed</a></div>
    <div class="grid grid-main">
      <div>${sections.replace('<section class="panel" id="sec-track">', drivers + '<section class="panel" id="sec-track">')}${incidents}${seed}</div>
      <aside class="panel red" id="inputs-side" style="position:sticky;top:84px">
        <div class="kicker">Live nominal prediction</div>
        <div class="big-score" id="side-time">${f(nom.total)}<small style="font-size:.35em;margin-left:6px;font-family:var(--font-ui)">s</small></div>
        <div class="small muted" id="side-sub">${i.runs} run(s) · ${f(nom.runs[0].carTime)} s car time · ${f(nom.vMax, 1)} m/s peak</div>
        <div id="side-checks" style="margin-top:12px"></div>
        <div class="btn-row" style="margin-top:16px"><button class="btn btn-primary" data-action="simulate">Simulate race</button><button class="btn btn-ghost btn-sm" data-action="save-scenario">Save as scenario</button></div>
        <p class="small muted" style="margin-top:12px">Updates as you type. Deterministic run with all random variables at their means.</p>
      </aside>
    </div>`
}
AFTER.inputs = () => updateSide()
function updateSide() {
  const side = $('#inputs-side'); if (!side) return
  const nom = getNominal()
  $('#side-time').innerHTML = `${f(nom.total)}<small style="font-size:.35em;margin-left:6px;font-family:var(--font-ui)">s</small>`
  $('#side-sub').textContent = `${state.inputs.runs} run(s) · ${f(nom.runs[0].carTime)} s car time · ${f(nom.vMax, 1)} m/s peak`
  const bad = runChecks(state.inputs, nom).filter(c => !c.pass)
  $('#side-checks').innerHTML = bad.length ? bad.map(c => `<div class="note red small">${esc(c.label)}${c.detail ? ` · ${esc(c.detail)}` : ''}</div>`).join('') : `<div class="note ok small">All sanity checks pass on the nominal run.</div>`
}

/* ------------------------------------------------------------------ */
/* 03 simulate                                                        */
/* ------------------------------------------------------------------ */
function startSimulation({ seed } = {}) {
  const i = state.inputs
  const s = seed ?? (i.seedMode === 'manual' ? i.seed : randomSeed())
  const race = simulateRace(i, { seed: s, recordTrace: true })
  race.rev = rev
  lastRace = race
  sim.pending = true
  if (view !== 'simulate') go('simulate'); else render()
}

RENDER.simulate = () => {
  const i = state.inputs
  const r = lastRace
  const phases = ['reaction', 'launch', 'acceleration', 'highSpeed', 'braking', 'transition']
  const controls = `
    <div class="btn-row">
      <button class="btn btn-primary btn-lg" data-action="simulate">Simulate race</button>
      ${r ? `<button class="btn btn-ghost" data-action="simulate-seed" data-seed="${r.seed}">Re-run seed ${r.seed}</button>` : ''}
      <span class="seg" role="group" aria-label="Animation speed">${[0.1, 0.25, 0.5, 1].map(s => `<button data-slowmo="${s}" aria-pressed="${sim.slowmo === s}">${s}×</button>`).join('')}<button data-action="skip-anim">Skip</button></span>
    </div>`
  return `
    ${head('Simulate', 'Race simulation', `Time-step simulation of ${i.runs} run(s) over ${i.trackLength} m with seeded variability and incidents. The animation is slowed down; the clock shows simulated time.`)}
    <div class="panel">
      ${controls}
      <div class="phase-strip" id="phase-strip">${phases.map(p => `<span data-phase="${p}">${PHASE_LABEL[p]}</span>`).join('')}</div>
      <div id="track-host">${trackSVG(i, 0, 'reaction')}</div>
      <div class="progress" style="margin-top:10px"><i id="sim-progress"></i></div>
      <div class="telemetry" style="margin-top:14px">
        ${[['Status', 'st-status', r ? 'Ready' : 'Idle', ''], ['Run', 'st-run', '—', ''], ['Elapsed (run)', 'st-time', '0.000', 's'], ['Speed', 'st-v', '0.00', 'm/s'], ['Acceleration', 'st-a', '0.0', 'm/s²'], ['Position', 'st-x', '0.00', 'm'], ['Phase', 'st-phase', '—', ''], ['Projected finish', 'st-proj', '—', 's'], ['Race total so far', 'st-total', '0.000', 's']].map(([l, id, v, u]) => `<div class="tele"><div class="lbl">${l}</div><div class="val" id="${id}">${v}${u ? `<small>${u}</small>` : ''}</div></div>`).join('')}
      </div>
      <div style="margin-top:14px"><div class="ui-sm muted" style="margin-bottom:6px">Incident notifications</div><div class="incident-feed" id="sim-feed"><div class="incident ok"><span class="t">—</span>Waiting for simulation</div></div></div>
    </div>
    <div id="final-result">${r && !sim.pending ? finalResultHTML(r) : ''}</div>`
}

function finalResultHTML(r) {
  const i = state.inputs
  const k = computeKPIs(r, i)
  const runRows = r.runs.map(x => `<tr><td>Run ${x.index + 1}</td><td>${esc(x.driverName)}</td><td class="num">${f(x.reaction)}</td><td class="num">${x.carTime != null ? f(x.carTime) : '—'}</td><td class="num"><strong>${f(x.timed)}</strong></td><td class="num">${f(x.vMax, 2)}</td><td class="num">${f(x.aMax, 1)}</td><td class="num">${f(x.stopDist, 2)}</td><td>${x.failed ? '<span class="fail">DNF</span>' : x.incidents.length || x.falseStart || x.overrun ? `<span class="rating Medium">${x.incidents.length + (x.falseStart ? 1 : 0) + (x.overrun ? 1 : 0)} event(s)</span>` : '<span class="pass">clean</span>'}</td></tr>`).join('')
  return `
    <div class="panel red" style="margin-top:20px">
      <div class="panel-head"><div><div class="kicker">Final result · simulated</div><h2>${f(r.total)} s</h2><div class="small muted">Seed ${r.seed} · ${r.runs.length} run(s) · event elapsed ${f(r.eventTime, 1)} s including transitions ${isStale(r) ? '· inputs changed since' : ''}</div></div>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" data-goto="replay">Replay race</button><button class="btn btn-ghost btn-sm" data-goto="telemetry">Telemetry</button><button class="btn btn-ghost btn-sm" data-goto="kpi">KPI analysis</button><button class="btn btn-ghost btn-sm" data-action="save-scenario">Save scenario</button></div></div>
      <div class="grid grid-4">
        ${stat('Total race time', f(r.total), 's')}${stat('Average run time', f(r.mean), 's')}${stat('Best run', f(r.best), 's')}${stat('Worst run', f(r.worst), 's')}
        ${stat('Average speed', f(r.avgSpeed, 2), 'm/s')}${stat('Maximum speed', f(r.vMax, 2), 'm/s')}${stat('Max acceleration', f(r.aMax, 1), 'm/s²')}${stat('Max deceleration', f(Math.abs(r.aMin), 1), 'm/s²')}
        ${stat('Consistency', (r.consistency * 100).toFixed(2), '%', `σ = ${f(r.sd)} s`, '', 'calculated')}${stat('Reliability', (r.reliability * 100).toFixed(0), '%', 'clean runs', '', 'calculated')}${stat('Penalty time', f(r.penaltyTime), 's')}${stat('Incident time', f(r.incidentTime), 's')}
      </div>
      <div class="grid grid-2" style="margin-top:20px">
        <div><div class="kicker" style="margin-bottom:10px">Time contributions (all runs)</div>${breakdownHTML(r.breakdown, r.total, { includeTransition: true })}</div>
        <div><div class="kicker" style="margin-bottom:10px">Incidents</div><div class="incident-feed">${incidentsHTML(r)}</div>
          <div class="kicker" style="margin:16px 0 8px">Overall KPI (development)</div><div class="big-score">${k.overall.toFixed(1)}</div><div class="small muted">nine team-weighted development factors · <button class="btn-link" data-goto="kpi">see breakdown</button></div></div>
      </div>
      <div class="table-wrap" style="margin-top:20px"><table><thead><tr><th>Run</th><th>Driver</th><th class="num">Reaction s</th><th class="num">Car time s</th><th class="num">Run time s</th><th class="num">v max m/s</th><th class="num">a max m/s²</th><th class="num">Stop dist m</th><th>Events</th></tr></thead><tbody>${runRows}</tbody></table></div>
    </div>`
}

AFTER.simulate = () => {
  if (sim.pending && lastRace) { sim.pending = false; animateRace(lastRace) }
  else if (lastRace) { paintFrame(lastRace.runs[lastRace.runs.length - 1], lastRace.runs[lastRace.runs.length - 1].trace.at(-1), lastRace, lastRace.total, true) }
}

function paintFrame(run, p, race, totalSoFar, done = false) {
  const i = state.inputs
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html }
  $('#track-host').innerHTML = trackSVG(i, p.x, p.phase, { finished: done })
  set('st-run', `${run.index + 1}<small>/ ${race.runs.length}</small>`)
  set('st-time', `${f(p.t)}<small>s</small>`)
  set('st-v', `${f(p.v, 2)}<small>m/s</small>`)
  set('st-a', `${f(p.a, 1)}<small>m/s²</small>`)
  set('st-x', `${f(p.x, 2)}<small>m</small>`)
  set('st-phase', PHASE_LABEL[p.phase] || p.phase)
  const proj = run.tFinish != null ? (p.t >= run.tFinish ? run.timed : run.tFinish) : null
  set('st-proj', proj != null ? `${f(proj)}<small>s</small>` : 'DNF')
  set('st-total', `${f(totalSoFar)}<small>s</small>`)
  set('st-status', done ? 'Complete' : 'Running')
  $$('#phase-strip span').forEach(s => { s.classList.toggle('on', s.dataset.phase === p.phase); s.classList.toggle('done', done || phaseIndex(s.dataset.phase) < phaseIndex(p.phase)) })
}
const PH_ORDER = ['reaction', 'launch', 'acceleration', 'highSpeed', 'braking', 'transition']
const phaseIndex = p => PH_ORDER.indexOf(p)

function animateRace(race) {
  sim.running = true
  setStatus('Simulating', 'live')
  const feed = $('#sim-feed'); feed.innerHTML = ''
  const note = (cls, t, txt) => { feed.insertAdjacentHTML('afterbegin', `<div class="incident ${cls}"><span class="t">${t}</span>${esc(txt)}</div>`) }
  // timeline of segments in *animation* seconds
  const segs = []
  let cursor = 0
  race.runs.forEach((run, k) => {
    const dur = run.trace.at(-1).t / sim.slowmo
    segs.push({ type: 'run', run, start: cursor, dur })
    cursor += dur
    if (k < race.runs.length - 1) { segs.push({ type: 'transition', run, start: cursor, dur: 1.4 }); cursor += 1.4 }
  })
  const totalAnim = cursor
  let announced = new Set()
  let t0 = performance.now()
  note('ok', '0.000', `Seed ${race.seed} · ${race.runs.length} run(s) · Δt ${state.inputs.dt} ms`)
  const frame = now => {
    if (!sim.running) return
    const ta = sim.skip ? totalAnim : (now - t0) / 1000
    const seg = segs.find(s => ta >= s.start && ta < s.start + s.dur) || segs[segs.length - 1]
    const totalBefore = race.runs.slice(0, seg.run.index).reduce((s, r) => s + r.timed, 0)
    if (seg.type === 'run') {
      const tr = Math.min(seg.run.trace.at(-1).t, (ta - seg.start) * sim.slowmo)
      const p = sampleTrace(seg.run.trace, tr)
      const key = `start${seg.run.index}`
      if (!announced.has(key)) { announced.add(key); note('ok', `R${seg.run.index + 1}`, `Run ${seg.run.index + 1} · ${seg.run.driverName} · reaction ${f(seg.run.reaction)} s`); if (seg.run.falseStart) note('major', `R${seg.run.index + 1}`, `False start! +${f(state.inputs.falseStartPenalty)} s penalty`) }
      for (const inc of seg.run.incidents) {
        const ik = `${seg.run.index}:${inc.key}`
        const at = inc.key === 'brakingError' ? (seg.run.tFinish ?? 0) : inc.key === 'poorReaction' ? 0 : seg.run.reaction
        if (!announced.has(ik) && tr >= at) { announced.add(ik); note(inc.severity === 'minor' ? '' : 'major', `R${seg.run.index + 1} ${f(tr)}`, inc.label) }
      }
      if (seg.run.overrun && tr >= (seg.run.tStop ?? 0) - 1e-6 && !announced.has(`ov${seg.run.index}`)) { announced.add(`ov${seg.run.index}`); note('major', `R${seg.run.index + 1}`, `Braking-zone overrun by ${f(seg.run.overrunDistance, 2)} m`) }
      if (p.t >= (seg.run.tFinish ?? Infinity) && !announced.has(`fin${seg.run.index}`)) { announced.add(`fin${seg.run.index}`); note('ok', `R${seg.run.index + 1}`, `Finish gate · run time ${f(seg.run.timed)} s${seg.run.failed ? ' (DNF – assigned time)' : ''}`) }
      paintFrame(seg.run, p, race, totalBefore + (p.t >= (seg.run.tFinish ?? Infinity) ? seg.run.timed : Math.min(p.t, seg.run.timed)))
    } else {
      const p = { ...seg.run.trace.at(-1), phase: 'transition' }
      paintFrame(seg.run, p, race, totalBefore + seg.run.timed)
      document.getElementById('st-phase').textContent = `Transition · ${f(seg.run.transition, 1)} s (compressed)`
    }
    $('#sim-progress').style.width = `${Math.min(100, (ta / totalAnim) * 100)}%`
    if (ta >= totalAnim) {
      sim.running = false; sim.skip = false
      const last = race.runs.at(-1)
      paintFrame(last, last.trace.at(-1), race, race.total, true)
      $('#sim-progress').style.width = '100%'
      note('ok', 'END', `Race complete · ${f(race.total)} s`)
      $('#final-result').innerHTML = finalResultHTML(race)
      setStatus(`Seed ${race.seed}`, '')
      return
    }
    sim.raf = requestAnimationFrame(frame)
  }
  sim.raf = requestAnimationFrame(frame)
}

/* ------------------------------------------------------------------ */
/* 04 telemetry                                                       */
/* ------------------------------------------------------------------ */
RENDER.telemetry = () => {
  const r = lastRace || getNominal()
  const src = lastRace ? `Last simulated race · seed ${lastRace.seed}` : 'Nominal model (no race simulated yet)'
  return `
    ${head('Live telemetry', 'Telemetry', `${src}. Hover the charts to read values.`, `<button class="btn btn-primary btn-sm" data-action="simulate">Simulate race</button>`)}
    ${staleNote(lastRace, 'race')}
    <div class="grid grid-2">
      <div class="chart-box"><h4>Speed vs time</h4><div id="ch-speed"></div></div>
      <div class="chart-box"><h4>Position vs time</h4><div id="ch-pos"></div></div>
      <div class="chart-box"><h4>Acceleration vs time</h4><div id="ch-acc"></div></div>
      <div class="chart-box"><h4>Forces vs time (run 1)</h4><div id="ch-force"></div></div>
      <div class="chart-box"><h4>Run times</h4><div id="ch-runs"></div></div>
      <div class="chart-box"><h4>Speed vs distance</h4><div id="ch-vx"></div></div>
    </div>
    <div class="panel" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">Run summary</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Run</th><th>Driver</th><th class="num">Reaction</th><th class="num">Launch delay</th><th class="num">Car time</th><th class="num">Run time</th><th class="num">v max</th><th class="num">a max</th><th class="num">Braking time</th><th class="num">Stop dist</th><th class="num">Drag share</th></tr></thead>
      <tbody>${r.runs.map(x => `<tr><td>${x.index + 1}</td><td>${esc(x.driverName)}</td><td class="num">${f(x.reaction)} s</td><td class="num">${f(x.launchDelay)} s</td><td class="num">${x.carTime != null ? f(x.carTime) + ' s' : '—'}</td><td class="num"><strong>${f(x.timed)} s</strong></td><td class="num">${f(x.vMax, 2)} m/s</td><td class="num">${f(x.aMax, 1)} m/s²</td><td class="num">${f(x.brakingTime)} s</td><td class="num">${f(x.stopDist, 2)} m</td><td class="num">${pct(x.dragShare)}</td></tr>`).join('')}</tbody></table></div></div>`
}
AFTER.telemetry = () => {
  const r = lastRace || getNominal()
  const runs = r.runs.filter(x => x.trace)
  const series = key => runs.map((x, k) => ({ name: `Run ${x.index + 1}`, color: COLORS[k % COLORS.length], points: x.trace.filter((_, j) => j % 2 === 0).map(p => [p.t, p[key]]) }))
  const r0 = runs[0]
  const bands = r0 ? phaseSegments(r0.trace).map(s => ({ x0: s.t0, x1: s.t1, label: PHASE_LABEL[s.phase], color: PHASE_COLORS[s.phase].startsWith('#') ? PHASE_COLORS[s.phase] + '14' : PHASE_COLORS[s.phase] })) : []
  lineChart($('#ch-speed'), { series: series('v'), xLabel: 'Time (s)', yLabel: 'Speed (m/s)', bands, xFmt: v => v.toFixed(2) + ' s', yFmt: v => v.toFixed(2) + ' m/s', markers: r0?.tFinish ? [{ x: r0.tFinish, label: 'finish (run 1)' }] : [] })
  lineChart($('#ch-pos'), { series: series('x'), xLabel: 'Time (s)', yLabel: 'Distance (m)', xFmt: v => v.toFixed(2) + ' s', yFmt: v => v.toFixed(2) + ' m', markers: [{ x: r0?.tFinish || 0, label: 'finish' }], bands })
  lineChart($('#ch-acc'), { series: series('a'), xLabel: 'Time (s)', yLabel: 'Acceleration (m/s²)', xFmt: v => v.toFixed(2) + ' s', yFmt: v => v.toFixed(1) + ' m/s²', bands })
  if (r0) lineChart($('#ch-force'), { series: [{ name: 'Thrust', color: COLORS[0], points: r0.trace.map(p => [p.t, p.Ft]) }, { name: 'Drag', color: COLORS[3], points: r0.trace.map(p => [p.t, p.Fd]) }, { name: 'Rolling + tether', color: COLORS[2], points: r0.trace.map(p => [p.t, p.Fr]) }], xLabel: 'Time (s)', yLabel: 'Force (N)', xFmt: v => v.toFixed(2) + ' s', yFmt: v => v.toFixed(3) + ' N', bands })
  barChart($('#ch-runs'), { items: r.runs.map((x, k) => ({ label: `Run ${x.index + 1}`, value: x.timed, color: x.failed ? '#555' : COLORS[0] })), yLabel: 'Run time (s)', yFmt: v => v.toFixed(3), yMin: 0, line: r.mean, lineLabel: `mean ${f(r.mean)} s` })
  lineChart($('#ch-vx'), { series: runs.map((x, k) => ({ name: `Run ${x.index + 1}`, color: COLORS[k % COLORS.length], points: x.trace.filter((_, j) => j % 2 === 0).map(p => [p.x, p.v]) })), xLabel: 'Distance (m)', yLabel: 'Speed (m/s)', xFmt: v => v.toFixed(2) + ' m', yFmt: v => v.toFixed(2) + ' m/s', markers: [{ x: state.inputs.trackLength, label: 'finish' }] })
}

/* ------------------------------------------------------------------ */
/* 05 replay                                                          */
/* ------------------------------------------------------------------ */
RENDER.replay = () => {
  const r = lastRace || getNominal()
  if (replayRun >= r.runs.length) replayRun = 0
  const run = r.runs[replayRun]
  return `
    ${head('Race replay', 'Replay', `${lastRace ? `Seed ${lastRace.seed}` : 'Nominal model'} · run ${replayRun + 1} of ${r.runs.length}. Real race time runs at ×1; slower speeds help read the launch.`)}
    <div class="panel">
      <div class="btn-row" style="margin-bottom:12px"><span class="seg" role="group" aria-label="Run">${r.runs.map((x, k) => `<button data-replay-run="${k}" aria-pressed="${k === replayRun}">Run ${k + 1}</button>`).join('')}</span><span class="small muted">${esc(run.driverName)} · run time ${f(run.timed)} s</span></div>
      <div id="rp-track">${trackSVG(state.inputs, 0, 'reaction')}</div>
      <div id="rp-timeline">${timelineHTML(phaseSegments(run.trace), 0, run.trace.at(-1).t)}</div>
      <div class="flow" style="margin-top:8px"><span>Start</span><b>→</b><span>Launch</span><b>→</b><span>Acceleration</span><b>→</b><span>Max-speed</span><b>→</b><span>Finish</span><b>→</b><span>Braking</span></div>
      <div class="replay-controls">
        <button class="btn btn-primary btn-sm" data-rp="play">Play</button><button class="btn btn-ghost btn-sm" data-rp="pause">Pause</button><button class="btn btn-ghost btn-sm" data-rp="restart">Restart</button>
        <span class="seg" role="group" aria-label="Replay speed">${[0.1, 0.25, 0.5, 1, 2, 5].map(s => `<button data-rp-speed="${s}" aria-pressed="${s === 0.25}">×${s}</button>`).join('')}</span>
        <input type="range" id="rp-scrub" min="0" max="${run.trace.at(-1).t}" step="0.001" value="0" aria-label="Scrub timeline" />
        <span class="mono" id="rp-clock">0.000 s</span>
      </div>
      <div class="telemetry" style="margin-top:14px">
        ${[['Time', 'rp-t', 's'], ['Speed', 'rp-v', 'm/s'], ['Acceleration', 'rp-a', 'm/s²'], ['Position', 'rp-x', 'm'], ['Thrust', 'rp-ft', 'N'], ['Drag', 'rp-fd', 'N'], ['Phase', 'rp-phase', '']].map(([l, id, u]) => `<div class="tele"><div class="lbl">${l}</div><div class="val" id="${id}">—${u ? `<small>${u}</small>` : ''}</div></div>`).join('')}
      </div>
    </div>`
}
AFTER.replay = () => {
  const r = lastRace || getNominal()
  const run = r.runs[replayRun]
  const trace = run.trace, tEnd = trace.at(-1).t
  const segs = phaseSegments(trace)
  const paint = t => {
    const p = sampleTrace(trace, t)
    $('#rp-track').innerHTML = trackSVG(state.inputs, p.x, p.phase, { finished: t >= tEnd - 1e-6 })
    $('#rp-timeline').innerHTML = timelineHTML(segs, t, tEnd)
    $('#rp-scrub').value = t; $('#rp-clock').textContent = `${f(t)} s`
    const set = (id, v, u) => { $('#' + id).innerHTML = `${v}${u ? `<small>${u}</small>` : ''}` }
    set('rp-t', f(p.t), 's'); set('rp-v', f(p.v, 2), 'm/s'); set('rp-a', f(p.a, 1), 'm/s²'); set('rp-x', f(p.x, 2), 'm'); set('rp-ft', f(p.Ft, 2), 'N'); set('rp-fd', f(p.Fd, 3), 'N'); set('rp-phase', PHASE_LABEL[p.phase])
  }
  replayer = new Replayer({ duration: tEnd, onFrame: paint, onEnd: () => {} })
  replayer.setSpeed(0.25)
  paint(0)
}

/* ------------------------------------------------------------------ */
/* 06 KPI                                                             */
/* ------------------------------------------------------------------ */
let kpiBasis = 'auto'
function kpiSource() {
  const i = state.inputs
  const haveMC = lastMC && !isStale(lastMC), haveRace = lastRace && !isStale(lastRace)
  const b = kpiBasis === 'auto' ? (haveMC ? 'mc' : haveRace ? 'race' : 'nominal') : kpiBasis
  if (b === 'mc' && haveMC) return { label: `Monte Carlo mean · ${lastMC.n} simulations`, k: computeKPIs(mcAsRace(lastMC, i), i, { mc: lastMC }), b }
  if (b === 'race' && lastRace) return { label: `Last simulated race · seed ${lastRace.seed}${isStale(lastRace) ? ' (stale)' : ''}`, k: computeKPIs(lastRace, i), b }
  return { label: 'Nominal model (deterministic)', k: computeKPIs(getNominal(), i), b: 'nominal' }
}
RENDER.kpi = () => {
  const i = state.inputs
  const { label, k, b } = kpiSource()
  const cls = s => (s >= 90 ? 'good' : s >= 70 ? 'mid' : 'bad')
  const card = x => `
          <div class="kpi-card" data-kpi="${x.key}"><div class="top"><div class="lbl">${esc(x.label)}${x.group === 'development' ? ` · ${x.weight} %` : ''}</div><div class="score ${cls(x.score)}">${x.score.toFixed(0)}</div></div>
            <div class="meter"><i style="width:${x.score}%"></i></div>
            <div class="vals"><span>value ${fmtKPI(x)}</span><span>target ${fmtKPI({ ...x, value: x.target })}</span></div>
            <details><summary>How was this calculated?</summary><div class="how">${esc(x.how)}<br><span class="muted">${esc(x.desc)}</span></div></details></div>`
  const devDefs = KPI_DEFS.filter(d => d.group === 'development'), outDefs = KPI_DEFS.filter(d => d.group === 'outcome')
  const betterText = d => d.better === 'lower' ? '↓ lower is better' : d.better === 'target' ? '◎ closest to target' : '↑ higher is better'
  return `
    ${head('KPI analysis', 'Performance indicators', 'Nine team-defined development KPIs, weighted into the Overall Performance Index, plus unweighted race-outcome indicators from the simulation. Weights and targets are the team’s own, not STEM Racing scoring rules.', `<span class="seg" role="group" aria-label="Outcome basis"><button data-kpi-basis="nominal" aria-pressed="${b === 'nominal'}">Nominal</button><button data-kpi-basis="race" aria-pressed="${b === 'race'}" ${lastRace ? '' : 'disabled'}>Last race</button><button data-kpi-basis="mc" aria-pressed="${b === 'mc'}" ${lastMC ? '' : 'disabled'}>Monte Carlo</button></span>`)}
    <div class="grid grid-main">
      <div>
        <div class="panel red"><div class="panel-head"><div><div class="kicker">Overall performance index</div><div class="big-score">${k.overall.toFixed(1)}</div><div class="small muted">Σ(weight × score) ÷ Σ weight over the nine development KPIs (weights total ${k.weightSum} %) · computed from the nominal model ${tag('calculated')}</div></div></div>
          <div class="chart-box" style="margin-top:10px"><h4>Development KPI scores vs target (100 = target met)</h4><div id="ch-kpi"></div></div></div>
        <div class="panel" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">Development KPIs · weighted</div><div class="hint">Properties of the car design from the nominal model. Time-loss KPIs are per run, from counterfactual simulations with that loss removed.</div></div>${tag('calculated')}</div>
          <div class="grid grid-2">${k.development.map(card).join('')}</div></div>
        <div class="panel" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">Race outcome indicators · unweighted</div><div class="hint">Basis: ${label}. Scored against targets for reference; they do not enter the Overall Performance Index.</div></div>${tag('predicted')}</div>
          <div class="grid grid-2">${k.outcome.map(card).join('')}</div>
          <div class="chart-box" style="margin-top:16px"><h4>Outcome indicator scores</h4><div id="ch-kpi-out"></div></div></div>
      </div>
      <aside class="panel"><div class="kicker">Team-defined KPI weights</div><p class="small muted" style="margin:6px 0 14px">Development weights as decided by the team (relative; shown as % of the total).</p>
        ${devDefs.map(d => `<div class="field" style="margin-bottom:12px"><label><span>${esc(d.label)} · weight ${i.kpi.weights[d.key]}</span><span class="muted">${betterText(d)}</span></label>
          <input type="range" min="0" max="40" step="1" value="${i.kpi.weights[d.key]}" data-kpi-weight="${d.key}" aria-label="${esc(d.label)} weight" />
          <div class="with-unit"><input type="number" value="${i.kpi.targets[d.key]}" step="${d.unit === 's' ? 0.01 : 0.5}" data-kpi-target="${d.key}" aria-label="${esc(d.label)} target" /><span class="unit">${esc(d.unit || 'target')}</span></div></div>`).join('')}
        <div class="kicker" style="margin:18px 0 6px">Outcome targets</div>
        ${outDefs.map(d => `<div class="field" style="margin-bottom:10px"><label><span>${esc(d.label)}</span><span class="muted">${betterText(d)}</span></label>
          <div class="with-unit"><input type="number" value="${i.kpi.targets[d.key]}" step="${d.unit === 's' ? 0.01 : 0.5}" data-kpi-target="${d.key}" aria-label="${esc(d.label)} target" /><span class="unit">${esc(d.unit || 'target')}</span></div></div>`).join('')}
        <button class="btn btn-ghost btn-sm" data-action="reset-kpi">Reset to defaults</button></aside>
    </div>`
}
AFTER.kpi = () => { const { k } = kpiSource(); kpiChart($('#ch-kpi'), { items: k.development.map(x => ({ label: x.label.length > 22 ? x.label.slice(0, 21) + '…' : x.label, score: x.score, valueText: fmtKPI(x) })) }); kpiChart($('#ch-kpi-out'), { items: k.outcome.map(x => ({ label: x.label, score: x.score, valueText: fmtKPI(x) })) }) }

/* ------------------------------------------------------------------ */
/* 07 Monte Carlo                                                     */
/* ------------------------------------------------------------------ */
RENDER.montecarlo = () => {
  const i = state.inputs
  const m = lastMC
  const st = m?.stats
  return `
    ${head('Monte Carlo', 'Monte Carlo analysis', 'Each simulation draws every uncertain variable from its distribution and runs the full time-step race. The result is the distribution of race times the model predicts, not a single number.')}
    <div class="panel">
      <div class="btn-row">
        <span class="seg" role="group" aria-label="Simulations">${[100, 500, 1000, 5000].map(n => `<button data-mc-n="${n}" aria-pressed="${mc.n === n}">${n.toLocaleString()}</button>`).join('')}</span>
        <div class="field"><div class="with-unit"><input type="number" id="mc-custom" value="${mc.n}" min="10" max="50000" step="10" aria-label="Custom number of simulations" style="width:10ch" /><span class="unit">custom</span></div></div>
        <div class="field"><div class="with-unit"><input type="number" id="mc-seed" value="${mc.baseSeed}" step="1" aria-label="Base seed" style="width:10ch" /><span class="unit">base seed</span></div></div>
        <button class="btn btn-primary" data-action="run-mc" ${mc.running ? 'disabled' : ''}>${mc.running ? 'Running…' : 'Run Monte Carlo'}</button>
        ${mc.running ? '<button class="btn btn-ghost" data-action="cancel-mc">Cancel</button>' : ''}
      </div>
      <div class="progress" style="margin-top:12px"><i id="mc-progress" style="width:${mc.progress * 100}%"></i></div>
      <p class="small muted" style="margin-top:8px">Target race time ${f(i.targetTime, 2)} s (from Strategy inputs). Simulation i uses seed hash(base, i), so the same base seed reproduces the whole analysis.</p>
    </div>
    ${m ? `
    ${staleNote(m, 'analysis')}
    <div class="grid grid-4" style="margin-top:20px">
      ${stat('Mean race time', f(st.mean), 's', `${m.n.toLocaleString()} simulations · ${(m.ms / 1000).toFixed(1)} s compute`, 'hero')}${stat('Median', f(st.median), 's')}${stat('Standard deviation', f(st.sd), 's', 'includes failed runs at the DNF time')}${stat('Best / worst case', `${f(st.min)} / ${f(st.max)}`, 's')}
      ${stat('5th percentile', f(st.p5), 's', 'fast-side limit')}${stat('25th percentile', f(st.p25), 's')}${stat('75th percentile', f(st.p75), 's')}${stat('95th percentile', f(st.p95), 's', 'slow-side limit')}
      ${stat(`P(beat ${f(i.targetTime, 2)} s)`, pct(m.pBeatTarget), '', 'probability of beating target', 'hero', 'predicted')}${stat('P(any incident)', pct(m.pIncident), '', `major: ${pct(m.pMajor)}`)}${stat('P(penalty-free race)', pct(m.pPenaltyFree), '')}${stat('Mean consistency', (m.meanConsistency * 100).toFixed(2), '%', `reliability ${(m.meanReliability * 100).toFixed(1)} %`)}
    </div>
    <div class="grid grid-2" style="margin-top:20px">
      <div class="chart-box"><h4>Race time distribution</h4><div id="ch-hist"></div></div>
      <div class="chart-box"><h4>Run time percentiles per run</h4><div id="ch-runstats"></div></div>
    </div>
    <div class="panel" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">Per-run statistics</div></div><div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="load-median">Load median race into telemetry/replay</button><button class="btn btn-ghost btn-sm" data-goto="kpi">KPI on Monte Carlo mean</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Run</th><th class="num">Mean</th><th class="num">Median</th><th class="num">σ</th><th class="num">P5</th><th class="num">P95</th><th class="num">Min</th><th class="num">Max</th></tr></thead><tbody>
        ${m.runStats.map((s, k) => `<tr><td>Run ${k + 1}</td><td class="num">${f(s.mean)}</td><td class="num">${f(s.median)}</td><td class="num">${f(s.sd)}</td><td class="num">${f(s.p5)}</td><td class="num">${f(s.p95)}</td><td class="num">${f(s.min)}</td><td class="num">${f(s.max)}</td></tr>`).join('')}
        <tr><td><strong>Race total</strong></td><td class="num"><strong>${f(st.mean)}</strong></td><td class="num">${f(st.median)}</td><td class="num">${f(st.sd)}</td><td class="num">${f(st.p5)}</td><td class="num">${f(st.p95)}</td><td class="num">${f(st.min)}</td><td class="num">${f(st.max)}</td></tr></tbody></table></div></div>` : `<div class="panel" style="margin-top:20px"><div class="chart-empty">No Monte Carlo results yet. Choose a number of simulations and run.</div></div>`}`
}
AFTER.montecarlo = () => {
  const m = lastMC; if (!m) return
  const i = state.inputs
  const span = Math.max(0.05, m.stats.p95 - m.stats.p5)
  const range = [Math.max(m.stats.min, Math.min(m.stats.p5 - 0.6 * span, i.targetTime - 0.05)), Math.min(m.stats.max + 1e-6, Math.max(m.stats.p95 + 0.8 * span, i.targetTime + 0.05))]
  const hist = histogramClamped(m.totals, range)
  histogramChart($('#ch-hist'), { hist, xLabel: 'Race time (s)', xFmt: v => v.toFixed(2), markers: [{ x: m.stats.mean, label: `mean ${f(m.stats.mean)}`, color: '#FFFBF8' }, { x: m.stats.median, label: `median ${f(m.stats.median)}`, color: '#4FC3F7' }, { x: m.stats.p5, label: 'P5', color: '#43D17C' }, { x: m.stats.p95, label: 'P95', color: '#F5A524' }, { x: i.targetTime, label: `target ${f(i.targetTime, 2)}`, color: '#B388FF' }] })
  barChart($('#ch-runstats'), { items: m.runStats.flatMap((s, k) => [{ label: `R${k + 1} P5`, value: s.p5, color: '#43D17C' }, { label: `R${k + 1} med`, value: s.median, color: COLORS[0] }, { label: `R${k + 1} P95`, value: s.p95, color: '#F5A524' }]), yLabel: 'Run time (s)', yFmt: v => v.toFixed(3), yMin: Math.floor(Math.min(...m.runStats.map(s => s.p5)) * 10) / 10 })
}
function histogramClamped(values, range) {
  const inRange = values.filter(v => v >= range[0] && v <= range[1])
  const bins = Math.min(50, Math.max(12, Math.round(Math.sqrt(values.length))))
  const w = (range[1] - range[0]) / bins
  const counts = new Array(bins).fill(0)
  for (const v of inRange) counts[Math.min(bins - 1, Math.floor((v - range[0]) / w))]++
  const outliers = values.length - inRange.length
  const slow = values.filter(v => v > range[1]).length, fast = outliers - slow
  if (slow) counts[bins - 1] += slow // slow outliers (DNFs, penalties) fold into the last bin
  if (fast) counts[0] += fast
  return { edges: Array.from({ length: bins + 1 }, (_, k) => range[0] + k * w), counts, width: w }
}
async function runMC() {
  if (mc.running) return
  const n = Math.max(10, Math.min(50000, parseInt($('#mc-custom')?.value, 10) || mc.n))
  mc.n = n; mc.baseSeed = parseInt($('#mc-seed')?.value, 10) || 1
  state.prefs.mcN = n; persist()
  mc.running = true; mc.progress = 0
  const ctrl = new AbortController(); mc.abort = ctrl
  setStatus(`Monte Carlo 0 %`, 'busy'); render()
  const snapshotRev = rev
  try {
    const res = await runMonteCarlo(state.inputs, n, { baseSeed: mc.baseSeed, signal: ctrl.signal, onProgress: p => { mc.progress = p; const el = $('#mc-progress'); if (el) el.style.width = `${p * 100}%`; setStatus(`Monte Carlo ${(p * 100).toFixed(0)} %`, 'busy') } })
    res.rev = snapshotRev
    lastMC = res
    toast(`${n.toLocaleString()} simulations in ${(res.ms / 1000).toFixed(1)} s`)
  } catch (e) { if (e.message !== 'cancelled') { console.error(e); toast('Monte Carlo failed: ' + e.message) } else toast('Cancelled') }
  mc.running = false; mc.abort = null
  setStatus('Idle', '')
  if (view === 'montecarlo') render()
}

/* ------------------------------------------------------------------ */
/* 08 sensitivity                                                     */
/* ------------------------------------------------------------------ */
let sensRel = 0.05
RENDER.sensitivity = () => {
  const s = lastSens
  return `
    ${head('Sensitivity', 'Parameter sensitivity', 'Controlled perturbation test on the deterministic model: each parameter is moved ±Δ and the race re-simulated. Elasticity = %Δ race time ÷ %Δ parameter. Ratings are relative to the most sensitive parameter in this table.')}
    <div class="panel"><div class="btn-row"><span class="seg" role="group" aria-label="Perturbation">${[0.02, 0.05, 0.1].map(r => `<button data-sens-rel="${r}" aria-pressed="${sensRel === r}">±${r * 100} %</button>`).join('')}</span><button class="btn btn-primary" data-action="run-sens">Run sensitivity</button>${s ? `<span class="small muted">Baseline ${f(s.base)} s · ${s.rows.length} parameters</span>` : ''}</div></div>
    ${s ? `${staleNote(s, 'analysis')}
    <div class="grid grid-2" style="margin-top:20px">
      <div class="panel"><div class="panel-head"><div><div class="kicker">Ranked by |elasticity|</div></div>${tag('calculated')}</div>
        <div class="table-wrap"><table><thead><tr><th>Parameter</th><th class="num">Current value</th><th>Sensitivity</th><th class="num">Elasticity</th><th class="num">Δt at −${s.rel * 100} %</th><th class="num">Δt at +${s.rel * 100} %</th><th class="num">Time impact per unit</th></tr></thead><tbody>
          ${s.rows.map(r => `<tr><td><strong>${esc(r.label)}</strong></td><td class="num">${r.key === 'reaction' ? f(r.value) : r.value} ${esc(r.unit)}</td><td><span class="rating ${r.rating}">${r.rating}</span></td><td class="num">${sign(r.elasticity, 3)}</td><td class="num ${r.impactMinus < 0 ? 'pass' : ''}">${sign(r.impactMinus)} s</td><td class="num ${r.impactPlus < 0 ? 'pass' : ''}">${sign(r.impactPlus)} s</td><td class="num">${sign(r.perUnit, 4)} s / ${esc(r.unitLabel)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted" style="margin-top:10px">Negative Δt = faster. Parameters at a schema limit (e.g. launch efficiency near 100 %) are perturbed asymmetrically. Braking shows zero time impact in finish-line timing mode by design; it still affects the braking KPI and overrun risk.</p></div>
      <div class="chart-box"><h4>Tornado · Δ race time for ±${s.rel * 100} %</h4><div id="ch-tornado"></div></div>
    </div>` : `<div class="panel" style="margin-top:20px"><div class="chart-empty">Run the analysis to rank parameters by their impact on race time.</div></div>`}`
}
AFTER.sensitivity = () => { if (lastSens) tornadoChart($('#ch-tornado'), { items: lastSens.rows.map(r => ({ label: r.label, low: r.impactMinus, high: r.impactPlus })), lowLabel: `−${lastSens.rel * 100} %`, highLabel: `+${lastSens.rel * 100} %` }) }

/* ------------------------------------------------------------------ */
/* 09 what-if                                                         */
/* ------------------------------------------------------------------ */
const WHATIF_PARAMS = [...SENSITIVITY_PARAMS.filter(p => !p.virtual), { key: 'reaction', label: 'Reaction time (all drivers)' }, { key: 'brakingZone', label: 'Braking zone length' }, { key: 'temperature', label: 'Air temperature' }, { key: 'runs', label: 'Number of runs' }]
function whatIfValue(key) { return key === 'reaction' ? state.inputs.drivers.reduce((s, d) => s + d.reactionMean, 0) / state.inputs.drivers.length : state.inputs[key] }
RENDER.whatif = () => {
  const w = lastWhatIf
  const cur = whatIfValue(whatIfSel.key)
  const p = getParam(whatIfSel.key)
  return `
    ${head('What if?', 'What-if analysis', 'Change one thing and see the predicted effect: deterministic race time plus a 300-simulation common-seed Monte Carlo so the probabilistic KPIs move for the same reason.')}
    <div class="panel">
      <div class="kicker" style="margin-bottom:8px">Preset questions</div>
      <div class="preset-list">${WHAT_IF_PRESETS.map(x => `<button data-whatif-preset="${x.id}" aria-pressed="${whatIfSel.type === 'preset' && whatIfSel.id === x.id}">${esc(x.label)}</button>`).join('')}</div>
      <div class="kicker" style="margin:18px 0 8px">Custom change</div>
      <div class="btn-row">
        <div class="field"><div class="with-unit"><select id="wi-key" aria-label="Parameter">${WHATIF_PARAMS.map(x => `<option value="${x.key}" ${x.key === whatIfSel.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div></div>
        <span class="small muted">current <code>${whatIfSel.key === 'reaction' ? f(cur) : cur} ${esc(p?.unit || (whatIfSel.key === 'reaction' ? 's' : ''))}</code> →</span>
        <div class="field"><div class="with-unit"><input type="number" id="wi-value" value="${whatIfSel.value ?? (whatIfSel.key === 'reaction' ? f(cur) : cur)}" step="${p?.step || 0.001}" aria-label="New value" style="width:12ch" /><span class="unit">${esc(p?.unit || (whatIfSel.key === 'reaction' ? 's' : ''))}</span></div></div>
        <button class="btn btn-ghost btn-sm" data-action="whatif-custom">Use custom</button>
        <button class="btn btn-primary" data-action="run-whatif" ${busy === 'whatif' ? 'disabled' : ''}>${busy === 'whatif' ? 'Computing…' : 'Run what-if'}</button>
      </div>
    </div>
    ${w ? `${staleNote(w, 'analysis')}
    <div class="panel red" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">${esc(w.label)}</div></div>${tag('predicted')}</div>
      <div class="compare-cols"><div><div class="ui-sm muted">Baseline</div><div class="v">${f(w.baseline)} s</div></div><div class="arrow">→</div><div><div class="ui-sm muted">Modified</div><div class="v">${f(w.predicted)} s</div></div></div>
      <div class="grid grid-4" style="margin-top:18px">
        ${stat('Time saved', `<span class="delta ${w.saved >= 0 ? 'pos' : 'neg'}">${sign(w.saved)}</span>`, 's', 'deterministic')}${stat('Improvement', `<span class="delta ${w.pct >= 0 ? 'pos' : 'neg'}">${sign(w.pct, 2)}</span>`, '%')}${stat('Overall KPI change', `<span class="delta ${w.kpiDelta >= 0 ? 'pos' : 'neg'}">${sign(w.kpiDelta, 1)}</span>`, 'pts', `${w.kpiBase.overall.toFixed(1)} → ${w.kpiMod.overall.toFixed(1)}`, '', 'calculated')}${stat('P(beat target)', w.pBeatBase != null ? `${pct(w.pBeatBase, 0)} → ${pct(w.pBeatMod, 0)}` : '—', '', `${w.mcBase?.n || 0} common-seed simulations`)}
      </div>
      <div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>KPI</th><th>Group</th><th class="num">Baseline value</th><th class="num">Modified value</th><th class="num">Score before</th><th class="num">Score after</th><th class="num">Δ score</th></tr></thead><tbody>
        ${w.kpiBase.items.map((k, idx) => { const m = w.kpiMod.items[idx]; const d = m.score - k.score; return `<tr><td>${esc(k.label)}</td><td class="small muted">${k.group === 'development' ? `dev · ${k.weight} %` : 'outcome'}</td><td class="num">${fmtKPI(k)}</td><td class="num">${fmtKPI(m)}</td><td class="num">${k.score.toFixed(0)}</td><td class="num">${m.score.toFixed(0)}</td><td class="num ${d > 0.05 ? 'pass' : d < -0.05 ? 'fail' : ''}">${sign(d, 1)}</td></tr>` }).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:10px">Scores are capped at 100, so a KPI already at its target cannot rise further. A lighter or faster car can lower the aerodynamic or braking KPI — that is a genuine trade-off the model exposes, not an error.</p></div>` : ''}`
}
async function runWhatIf() {
  if (busy) return
  let label, apply
  if (whatIfSel.type === 'preset') { const pr = WHAT_IF_PRESETS.find(x => x.id === whatIfSel.id); label = pr.label; apply = pr.apply }
  else {
    const key = whatIfSel.key, v = whatIfSel.value
    const p = getParam(key)
    label = `${WHATIF_PARAMS.find(x => x.key === key)?.label || key}: ${key === 'reaction' ? f(whatIfValue(key)) : whatIfValue(key)} → ${v} ${p?.unit || ''}`
    apply = c => { if (key === 'reaction') c.drivers.forEach(d => { d.reactionMean = v }); else c[key] = v }
  }
  busy = 'whatif'; setStatus('What-if', 'busy'); render()
  const snap = rev
  try {
    const res = await whatIf(state.inputs, apply, { mcN: 300, baseSeed: 7, onProgress: p => setStatus(`What-if ${(p * 100).toFixed(0)} %`, 'busy') })
    res.label = label; res.rev = snap; lastWhatIf = res
  } catch (e) { console.error(e); toast('What-if failed: ' + e.message) }
  busy = null; setStatus('Idle', ''); if (view === 'whatif') render()
}

/* ------------------------------------------------------------------ */
/* 10 scenarios                                                       */
/* ------------------------------------------------------------------ */
RENDER.scenarios = () => {
  const sc = state.scenarios
  const sel = sc.filter(s => scenarioSel.has(s.id))
  const rows = [
    ['Predicted race time (nominal)', s => f(s.summary.nominal) + ' s'], ['Mean race time (MC)', s => f(s.summary.mcMean) + ' s'], ['P5 – P95 (MC)', s => `${f(s.summary.p5)} – ${f(s.summary.p95)} s`],
    ['Average speed', s => f(s.summary.avgSpeed, 2) + ' m/s'], ['Maximum speed', s => f(s.summary.vMax, 2) + ' m/s'], ['Consistency', s => (s.summary.consistency * 100).toFixed(2) + ' %'],
    ['Incident probability', s => pct(s.summary.pIncident)], ['Penalty-free probability', s => pct(s.summary.pPenaltyFree)], ['P(beat target)', s => `${pct(s.summary.pBeat)} (target ${f(s.summary.target, 2)} s)`],
    ['Overall KPI (development)', s => s.summary.kpi.toFixed(1)], ['Mass / Cd / Crr / bearing', s => `${s.inputs.mass} g / ${s.inputs.cd} / ${s.inputs.crr} / ${s.inputs.bearingTorque ?? '—'} N·mm`], ['Yaw margin / rear weight', s => `${(((s.inputs.cpOffset || 0) / (s.inputs.wheelbase || 1)) * 100).toFixed(1)} % / ${(50 + ((s.inputs.comOffset || 0) / (s.inputs.wheelbase || 1)) * 100).toFixed(1)} %`], ['Impulse / τ / η', s => `${s.inputs.impulse} N·s / ${s.inputs.thrustTau} s / ${s.inputs.launchEfficiency} %`],
    ['Reaction means', s => s.inputs.drivers.map(d => f(d.reactionMean)).join(' / ') + ' s'], ['Strategy', s => ['Conservative', 'Balanced', 'Aggressive'][s.inputs.strategyMode] + ` · risk ${s.inputs.riskLevel} %`],
  ]
  return `
    ${head('Scenario comparison', 'Scenarios', 'Save the current inputs as a named scenario (a 500-simulation Monte Carlo summary is stored with it), then compare scenarios side by side.', `<div class="field"><div class="with-unit"><input type="text" id="sc-name" placeholder="e.g. Lightweight car" aria-label="Scenario name" style="width:22ch" /></div></div><button class="btn btn-primary btn-sm" data-action="save-scenario" ${busy ? 'disabled' : ''}>${busy === 'scenario' ? 'Saving…' : 'Save current as scenario'}</button>`)}
    <div class="panel"><div class="panel-head"><div><div class="kicker">Saved scenarios</div><div class="hint">Tick scenarios to compare. Load replaces the current inputs.</div></div><div class="pill-list">${['Current Car', 'Lightweight Car', 'Aero Optimised', 'Driver Optimised', 'Maximum Reliability', 'Aggressive Strategy'].map(n => `<button class="pill" data-sc-suggest="${n}">${n}</button>`).join('')}</div></div>
      ${sc.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Scenario</th><th>Saved</th><th class="num">Nominal</th><th class="num">MC mean</th><th class="num">P(beat)</th><th class="num">KPI</th><th></th></tr></thead><tbody>
        ${sc.map(s => `<tr><td><input type="checkbox" data-sc-select="${s.id}" ${scenarioSel.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.name)}" /></td><td><strong>${esc(s.name)}</strong></td><td class="small muted">${new Date(s.created).toLocaleString()}</td><td class="num">${f(s.summary.nominal)} s</td><td class="num">${f(s.summary.mcMean)} s</td><td class="num">${pct(s.summary.pBeat, 0)}</td><td class="num">${s.summary.kpi.toFixed(1)}</td><td class="btn-row"><button class="btn btn-ghost btn-sm" data-action="load-scenario" data-id="${s.id}">Load</button><button class="btn btn-ghost btn-sm" data-action="delete-scenario" data-id="${s.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="chart-empty">No scenarios saved yet.</div>'}</div>
    ${sel.length ? `<div class="panel" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">Side-by-side</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Metric</th>${sel.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([l, fn]) => `<tr><td>${l}</td>${sel.map(s => `<td class="num">${fn(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="chart-box" style="margin-top:16px"><h4>Mean race time (Monte Carlo) by scenario</h4><div id="ch-sc"></div></div></div>` : ''}`
}
AFTER.scenarios = () => { const sel = state.scenarios.filter(s => scenarioSel.has(s.id)); if (sel.length) barChart($('#ch-sc'), { items: sel.map((s, k) => ({ label: s.name.slice(0, 14), value: s.summary.mcMean, color: COLORS[k % COLORS.length] })), yLabel: 'Race time (s)', yFmt: v => v.toFixed(3), yMin: Math.floor(Math.min(...sel.map(s => s.summary.p5)) * 10) / 10, line: state.inputs.targetTime, lineLabel: 'target' }) }

async function saveScenario(nameFromInput) {
  if (busy) return
  const name = (nameFromInput || $('#sc-name')?.value || '').trim() || `Scenario ${state.scenarios.length + 1}`
  busy = 'scenario'; setStatus('Saving scenario', 'busy'); if (view === 'scenarios') render()
  const inputs = clone(state.inputs)
  const nom = nominalRace(inputs)
  const m = await runMonteCarlo(inputs, 500, { baseSeed: 11, onProgress: p => setStatus(`Scenario MC ${(p * 100).toFixed(0)} %`, 'busy') })
  const k = computeKPIs(mcAsRace(m, inputs), inputs, { mc: m })
  const summary = { nominal: nom.total, mcMean: m.stats.mean, p5: m.stats.p5, p95: m.stats.p95, sd: m.stats.sd, avgSpeed: m.meanAvgSpeed, vMax: m.meanVmax, consistency: m.meanConsistency, reliability: m.meanReliability, pIncident: m.pIncident, pPenaltyFree: m.pPenaltyFree, pBeat: m.pBeatTarget, target: inputs.targetTime, kpi: k.overall }
  const s = store.newScenario(name, inputs, summary)
  state.scenarios.push(s); scenarioSel.add(s.id); persist()
  busy = null; setStatus('Idle', ''); toast(`Saved “${name}”`)
  if (view !== 'scenarios') go('scenarios'); else render()
}

/* ------------------------------------------------------------------ */
/* 11 model / assumptions                                             */
/* ------------------------------------------------------------------ */
RENDER.model = () => {
  const i = state.inputs
  const race = lastRace || getNominal()
  const checks = runChecks(i, race)
  const kindRows = SCHEMA.flatMap(sec => sec.params.map(p => ({ ...p, section: sec.title })))
  return `
    ${head('Model / assumptions', 'Model validation', 'Everything the simulator assumes, in one place. Predicted values are only as good as these inputs; calibrate against measured runs to improve them.')}
    <div class="grid grid-2">
      <div class="panel"><div class="panel-head"><div><div class="kicker">Simulation metadata</div></div></div>
        <div class="grid grid-2">${stat('Time step Δt', i.dt, 'ms', 'semi-implicit Euler', '', 'model')}${stat('Random seed', lastRace ? lastRace.seed : '—', '', lastRace ? 'last simulated race' : 'no race yet', '', 'model')}${stat('Monte Carlo simulations', lastMC ? lastMC.n.toLocaleString() : '—', '', lastMC ? `base seed ${lastMC.baseSeed}` : 'not run', '', 'model')}${stat('Runs per race', i.runs, '', `${i.timingMode === 1 ? 'full-stop' : 'finish-line'} timing`, '', 'strategy')}</div></div>
      <div class="panel"><div class="panel-head"><div><div class="kicker">Sanity checks</div><div class="hint">On inputs and the ${lastRace ? 'last simulated race' : 'nominal run'}.</div></div></div>
        <div class="table-wrap"><table><tbody>${checks.map(c => `<tr><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'}</td><td>${esc(c.label)}</td><td class="small muted">${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <div class="panel" style="margin-top:20px"><div class="panel-head"><div><div class="kicker">Equations used</div><div class="hint">SI units internally: m, kg, s, N, m/s, m/s², kg/m³. UI units (g, mm, cm², ms, hPa, %) are converted once per simulation.</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Quantity</th><th>Equation</th><th>Notes</th></tr></thead><tbody>${EQUATIONS.map(e => `<tr><td><strong>${esc(e.name)}</strong></td><td><span class="eq">${esc(e.eq)}</span></td><td class="small muted">${esc(e.note)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-head"><div><div class="kicker">Probability distributions</div></div>${tag('random')}</div>
      <div class="table-wrap"><table><thead><tr><th>Variable</th><th>Distribution</th><th>Notes</th></tr></thead><tbody>${DISTRIBUTIONS.map(d => `<tr><td><strong>${esc(d.name)}</strong></td><td><code>${esc(d.dist)}</code></td><td class="small muted">${esc(d.note)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="grid grid-2"><div class="panel"><div class="panel-head"><div><div class="kicker">Input assumptions</div></div></div><ol style="padding-left:20px;display:grid;gap:8px;font-size:.9rem;color:var(--ink-soft)">${ASSUMPTIONS.map(a => `<li>${esc(a)}</li>`).join('')}</ol></div>
      <div class="panel"><div class="panel-head"><div><div class="kicker">Model limitations</div></div></div><ol style="padding-left:20px;display:grid;gap:8px;font-size:.9rem;color:var(--ink-soft)">${LIMITATIONS.map(a => `<li>${esc(a)}</li>`).join('')}</ol></div></div>
    <div class="panel"><div class="panel-head"><div><div class="kicker">Current parameter values &amp; provenance</div><div class="hint">Calibration parameters are those marked Assumption or Model.</div></div>${kindsLegend()}</div>
      <div class="table-wrap"><table><thead><tr><th>Section</th><th>Parameter</th><th class="num">Value</th><th>Unit</th><th>Provenance</th></tr></thead><tbody>${kindRows.map(p => `<tr><td class="small muted">${esc(p.section)}</td><td>${esc(p.label)}</td><td class="num">${p.type === 'select' ? esc(p.options.find(o => o.v === i[p.key])?.l || i[p.key]) : i[p.key]}</td><td class="small muted">${esc(p.unit)}</td><td>${tag(p.kind)}</td></tr>`).join('')}</tbody></table></div></div>`
}

/* ------------------------------------------------------------------ */
/* 12 calibration                                                     */
/* ------------------------------------------------------------------ */
RENDER.calibration = () => {
  const c = calib
  return `
    ${head('Calibration', 'Measured vs simulated', 'Import real test-run data to compare against the model, see the error, and fit the calibration parameters. This is how the simulator becomes a digital twin of the actual car.')}
    <div class="grid grid-main">
      <div class="panel"><div class="panel-head"><div><div class="kicker">Measured data (CSV)</div><div class="hint">Columns: <code>time, distance, velocity, acceleration, run_number</code>. Time in seconds from the start signal (or from first movement — choose the alignment below). Distance in m, velocity in m/s. Blank cells are allowed.</div></div>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="csv-upload">Upload CSV</button><button class="btn btn-ghost btn-sm" data-action="csv-sample">Load sample</button></div></div>
        <div class="field"><textarea id="csv-text" spellcheck="false" placeholder="time,distance,velocity,acceleration,run_number&#10;0.000,0.000,0.00,,1&#10;0.050,0.000,0.00,,1&#10;…">${esc(state.calibrationCSV)}</textarea></div>
        <div class="btn-row" style="margin-top:12px"><span class="seg" role="group" aria-label="Alignment"><button data-align="motion" aria-pressed="${c.align === 'motion'}">Align at first movement</button><button data-align="signal" aria-pressed="${c.align === 'signal'}">t = 0 is start signal</button></span><button class="btn btn-primary" data-action="csv-parse">Compare</button></div>
        ${c.error ? `<div class="note red" style="margin-top:12px">${esc(c.error)}</div>` : ''}</div>
      <aside class="panel"><div class="kicker">Calibrate parameters</div><p class="small muted" style="margin:6px 0 12px">Coordinate-descent fit minimising the normalised RMSE of distance, velocity and acceleration against every measured run.</p>
        ${CALIBRATABLE.map(k => `<label class="check" style="display:flex;margin-bottom:8px"><input type="checkbox" data-cal-key="${k}" ${c.keys.includes(k) ? 'checked' : ''} /> ${esc(getParam(k).label)} <span class="muted">(${state.inputs[k]} ${esc(getParam(k).unit)})</span></label>`).join('')}
        <button class="btn btn-primary" data-action="run-calib" ${c.cmp ? '' : 'disabled'} style="margin-top:8px">Fit parameters</button>
        ${c.result ? `<div style="margin-top:14px"><div class="ui-sm muted">Result</div><div class="small">Cost ${c.result.before.toFixed(4)} → <strong>${c.result.after.toFixed(4)}</strong> (${((1 - c.result.after / c.result.before) * 100).toFixed(0)} % lower)</div>
          <div class="table-wrap"><table><tbody>${c.result.changes.map(ch => `<tr><td>${esc(ch.label)}</td><td class="num">${+ch.from.toFixed(5)}</td><td>→</td><td class="num"><strong>${+ch.to.toFixed(5)}</strong></td><td class="small muted">${esc(ch.unit)}</td></tr>`).join('') || '<tr><td class="muted">No change found</td></tr>'}</tbody></table></div>
          <div class="btn-row" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-action="apply-calib" ${c.result.changes.length ? '' : 'disabled'}>Apply to inputs</button></div></div>` : ''}</aside>
    </div>
    ${c.cmp ? `<div class="grid grid-4" style="margin-top:20px">${c.cmp.runs.map(r => stat(`Run ${r.run}`, `${Number.isFinite(r.rmseX) ? f(r.rmseX, 3) : '—'}`, 'm RMSE', `${Number.isFinite(r.rmseV) ? 'v RMSE ' + f(r.rmseV, 2) + ' m/s · ' : ''}${Number.isFinite(r.biasX) ? 'bias ' + sign(r.biasX, 3) + ' m' : ''}${r.measFinish != null ? ` · finish ${f(r.measFinish)} vs sim ${f(r.simFinish)} s` : ''}`, '', 'calculated')).join('')}</div>
    <div class="grid grid-2" style="margin-top:20px"><div class="chart-box"><h4>Distance · measured vs simulated</h4><div id="ch-cal-x"></div></div><div class="chart-box"><h4>Velocity · measured vs simulated</h4><div id="ch-cal-v"></div></div><div class="chart-box"><h4>Error = measured − simulated (distance)</h4><div id="ch-cal-ex"></div></div><div class="chart-box"><h4>Error = measured − simulated (velocity)</h4><div id="ch-cal-ev"></div></div></div>` : ''}`
}
AFTER.calibration = () => {
  const c = calib; if (!c.cmp) return
  const sim = c.cmp.sim.trace.filter((_, k) => k % 2 === 0)
  const meas = (key) => c.cmp.runs.map((r, k) => ({ name: `Measured run ${r.run}`, color: COLORS[(k + 2) % COLORS.length], dots: true, width: 1.5, points: r.series.filter(s => Number.isFinite(s[key])).map(s => [s.t + r.shift, s[key]]) }))
  lineChart($('#ch-cal-x'), { series: [{ name: 'Simulated (nominal)', color: COLORS[0], points: sim.map(p => [p.t, p.x]) }, ...meas('x')], xLabel: 'Time (s, simulation frame)', yLabel: 'Distance (m)', xFmt: v => v.toFixed(3), yFmt: v => v.toFixed(2) + ' m' })
  lineChart($('#ch-cal-v'), { series: [{ name: 'Simulated (nominal)', color: COLORS[0], points: sim.map(p => [p.t, p.v]) }, ...meas('v')], xLabel: 'Time (s, simulation frame)', yLabel: 'Velocity (m/s)', xFmt: v => v.toFixed(3), yFmt: v => v.toFixed(2) + ' m/s' })
  lineChart($('#ch-cal-ex'), { series: c.cmp.runs.map((r, k) => ({ name: `Run ${r.run}`, color: COLORS[(k + 2) % COLORS.length], dots: true, points: r.series.filter(s => Number.isFinite(s.ex)).map(s => [s.t + r.shift, s.ex]) })), xLabel: 'Time (s)', yLabel: 'Error (m)', xFmt: v => v.toFixed(3), yFmt: v => sign(v, 3) + ' m', markers: [] })
  lineChart($('#ch-cal-ev'), { series: c.cmp.runs.map((r, k) => ({ name: `Run ${r.run}`, color: COLORS[(k + 2) % COLORS.length], dots: true, points: r.series.filter(s => Number.isFinite(s.ev)).map(s => [s.t + r.shift, s.ev]) })), xLabel: 'Time (s)', yLabel: 'Error (m/s)', xFmt: v => v.toFixed(3), yFmt: v => sign(v, 2) + ' m/s' })
}
function parseCalibration() {
  const text = $('#csv-text')?.value || ''
  state.calibrationCSV = text; persist()
  try { const rows = parseCSV(text); calib.runs = groupRuns(rows); calib.cmp = compare(state.inputs, calib.runs, calib.align); calib.error = null; calib.result = null }
  catch (e) { calib.error = e.message; calib.cmp = null }
  render()
}
function sampleCSV() {
  // synthetic "measured" data from a slightly different car, so the fit has something to find
  const truth = { ...clone(state.inputs), cd: state.inputs.cd * 1.15, crr: state.inputs.crr * 1.5, impulse: state.inputs.impulse * 0.97, runs: 1 }
  const lines = ['time,distance,velocity,acceleration,run_number']
  for (const run of [1, 2]) {
    const t = nominalRace({ ...truth, impulse: truth.impulse * (run === 1 ? 1 : 1.015) }, true).runs[0].trace
    t.filter((p, k) => k % 12 === 0 && p.phase !== 'braking').forEach(p => lines.push(`${p.t.toFixed(3)},${Math.max(0, p.x + Math.sin(p.t * 37 + run) * 0.01).toFixed(4)},${Math.max(0, p.v + Math.cos(p.t * 29 + run) * 0.08).toFixed(3)},,${run}`))
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* events                                                             */
/* ------------------------------------------------------------------ */
function setInput(key, raw, type) {
  const p = getParam(key)
  let v = raw
  if (type !== 'string') { v = parseFloat(raw); if (!Number.isFinite(v)) return; if (p) v = Math.min(p.max, Math.max(p.min, v)) }
  if (state.inputs[key] === v) return
  state.inputs[key] = v
  invalidate(); persist()
}

document.addEventListener('input', e => {
  const t = e.target
  if (t.matches('[data-key]')) {
    setInput(t.dataset.key, t.value, t.dataset.type || 'number')
    if (t.dataset.key === 'seedMode') { const s = $('[data-key="seed"]'); if (s) s.disabled = t.value !== 'manual' }
    if (t.dataset.key === 'airDensityMode' || t.dataset.key === 'runs') { render(); return }
    updateSide()
  } else if (t.matches('[data-driver]')) {
    const d = state.inputs.drivers.find(x => x.id === t.dataset.driver); if (!d) return
    const fd = DRIVER_FIELDS.find(x => x.key === t.dataset.field)
    if (t.dataset.field === 'name') d.name = t.value
    else { const v = parseFloat(t.value); if (!Number.isFinite(v)) return; d[t.dataset.field] = Math.min(fd.max, Math.max(fd.min, v)) }
    invalidate(); persist(); updateSide()
  } else if (t.matches('[data-inc]')) {
    const c = state.inputs.incidents[t.dataset.inc]; const v = parseFloat(t.value); if (!c || !Number.isFinite(v)) return
    c[t.dataset.field] = t.dataset.field === 'prob' ? Math.min(1, Math.max(0, v)) : Math.max(0, v)
    invalidate(); persist()
  } else if (t.matches('[data-kpi-weight]')) {
    state.inputs.kpi.weights[t.dataset.kpiWeight] = parseInt(t.value, 10) || 0; persist()
    const lbl = t.closest('.field').querySelector('label span'); if (lbl) lbl.textContent = `${KPI_DEFS.find(d => d.key === t.dataset.kpiWeight).label} · weight ${t.value}`
    refreshKPI()
  } else if (t.matches('[data-kpi-target]')) {
    const v = parseFloat(t.value); if (!Number.isFinite(v)) return
    state.inputs.kpi.targets[t.dataset.kpiTarget] = v; persist(); refreshKPI()
  } else if (t.matches('#rp-scrub') && replayer) { replayer.pause(); replayer.seek(parseFloat(t.value)) }
})
function refreshKPI() {
  // re-render only the score side of the KPI page so the sliders keep focus
  const { k } = kpiSource()
  const big = $('.big-score'); if (big) big.textContent = k.overall.toFixed(1)
  kpiChart($('#ch-kpi'), { items: k.development.map(x => ({ label: x.label.length > 22 ? x.label.slice(0, 21) + '…' : x.label, score: x.score, valueText: fmtKPI(x) })) })
  kpiChart($('#ch-kpi-out'), { items: k.outcome.map(x => ({ label: x.label, score: x.score, valueText: fmtKPI(x) })) })
  for (const x of k.items) {
    const card = $(`.kpi-card[data-kpi="${x.key}"]`); if (!card) continue
    card.querySelector('.lbl').textContent = `${x.label}${x.group === 'development' ? ` · ${x.weight} %` : ''}`
    card.querySelector('.score').textContent = x.score.toFixed(0); card.querySelector('.score').className = `score ${x.score >= 90 ? 'good' : x.score >= 70 ? 'mid' : 'bad'}`
    card.querySelector('.meter i').style.width = `${x.score}%`
    card.querySelector('.vals').innerHTML = `<span>value ${fmtKPI(x)}</span><span>target ${fmtKPI({ ...x, value: x.target })}</span>`
    card.querySelector('.how').innerHTML = `${esc(x.how)}<br><span class="muted">${esc(x.desc)}</span>`
  }
}

document.addEventListener('change', e => {
  const t = e.target
  if (t.matches('[data-sc-select]')) { t.checked ? scenarioSel.add(t.dataset.scSelect) : scenarioSel.delete(t.dataset.scSelect); render() }
  else if (t.matches('[data-cal-key]')) { calib.keys = $$('[data-cal-key]:checked').map(x => x.dataset.calKey) }
  else if (t.matches('#wi-key')) { whatIfSel = { type: 'custom', key: t.value, value: null }; render() }
  else if (t.matches('#import-file')) { const file = t.files[0]; if (!file) return; file.text().then(txt => { try { const d = store.importJSON(txt); state.inputs = d.inputs; state.scenarios = d.scenarios; state.calibrationCSV = d.calibrationCSV; invalidate(); persist(); render(); toast('Data imported') } catch (err) { toast('Import failed: ' + err.message) } }); t.value = '' }
  else if (t.matches('#csv-file')) { const file = t.files[0]; if (!file) return; file.text().then(txt => { const ta = $('#csv-text'); if (ta) ta.value = txt; parseCalibration() }); t.value = '' }
})

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-goto],[data-scroll],[data-slowmo],[data-replay-run],[data-rp],[data-rp-speed],[data-kpi-basis],[data-mc-n],[data-sens-rel],[data-whatif-preset],[data-sc-suggest],[data-align]')
  if (!el) return
  const i = state.inputs
  if (el.dataset.goto) { e.preventDefault(); go(el.dataset.goto); return }
  if (el.dataset.scroll) { e.preventDefault(); document.getElementById(el.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
  if (el.dataset.slowmo) { sim.slowmo = parseFloat(el.dataset.slowmo); $$('[data-slowmo]').forEach(b => b.setAttribute('aria-pressed', b === el)); return }
  if (el.dataset.replayRun != null) { replayRun = parseInt(el.dataset.replayRun, 10); render(); return }
  if (el.dataset.rp && replayer) { replayer[el.dataset.rp](); return }
  if (el.dataset.rpSpeed && replayer) { replayer.setSpeed(parseFloat(el.dataset.rpSpeed)); $$('[data-rp-speed]').forEach(b => b.setAttribute('aria-pressed', b === el)); return }
  if (el.dataset.kpiBasis) { kpiBasis = el.dataset.kpiBasis; render(); return }
  if (el.dataset.mcN) { mc.n = parseInt(el.dataset.mcN, 10); const c = $('#mc-custom'); if (c) c.value = mc.n; $$('[data-mc-n]').forEach(b => b.setAttribute('aria-pressed', b === el)); return }
  if (el.dataset.sensRel) { sensRel = parseFloat(el.dataset.sensRel); $$('[data-sens-rel]').forEach(b => b.setAttribute('aria-pressed', b === el)); return }
  if (el.dataset.whatifPreset) { whatIfSel = { ...whatIfSel, type: 'preset', id: el.dataset.whatifPreset }; render(); return }
  if (el.dataset.scSuggest) { const inp = $('#sc-name'); if (inp) inp.value = el.dataset.scSuggest; return }
  if (el.dataset.align) { calib.align = el.dataset.align; if (calib.runs) { calib.cmp = compare(i, calib.runs, calib.align); calib.result = null } render(); return }
  switch (el.dataset.action) {
    case 'simulate': startSimulation(); break
    case 'simulate-seed': startSimulation({ seed: parseInt(el.dataset.seed, 10) }); break
    case 'skip-anim': sim.skip = true; break
    case 'add-driver': { const n = i.drivers.length + 1; i.drivers.push({ id: `d${Date.now().toString(36)}`, ...DRIVER_DEFAULTS, name: `Driver ${String.fromCharCode(64 + n)}` }); invalidate(); persist(); render(); break }
    case 'remove-driver': { i.drivers = i.drivers.filter(d => d.id !== el.dataset.id); if (i.driverAllocation === el.dataset.id) i.driverAllocation = 'alternate'; invalidate(); persist(); render(); break }
    case 'reset-inputs': if (confirm('Reset every input to the default starting assumptions? Saved scenarios are kept.')) { state.inputs = defaultInputs(); invalidate(); persist(); render(); toast('Inputs reset') } break
    case 'reset-kpi': { const d = defaultInputs(); i.kpi = d.kpi; persist(); render(); break }
    case 'export': store.exportJSON(state); break
    case 'import': $('#import-file').click(); break
    case 'run-mc': runMC(); break
    case 'cancel-mc': mc.abort?.abort(); break
    case 'load-median': if (lastMC?.medianSeed != null) { lastRace = simulateRace(i, { seed: lastMC.medianSeed, recordTrace: true }); lastRace.rev = lastMC.rev; toast(`Loaded median race (seed ${lastMC.medianSeed})`); go('telemetry') } break
    case 'run-sens': { setStatus('Sensitivity', 'busy'); setTimeout(() => { lastSens = sensitivity(i, SENSITIVITY_PARAMS, sensRel); lastSens.rev = rev; setStatus('Idle', ''); render() }, 10); break }
    case 'whatif-custom': { const v = parseFloat($('#wi-value')?.value); if (!Number.isFinite(v)) { toast('Enter a value'); break } whatIfSel = { type: 'custom', key: $('#wi-key').value, value: v }; runWhatIf(); break }
    case 'run-whatif': { if (whatIfSel.type === 'custom') { const v = parseFloat($('#wi-value')?.value); if (Number.isFinite(v)) whatIfSel.value = v } runWhatIf(); break }
    case 'save-scenario': saveScenario(); break
    case 'load-scenario': { const s = state.scenarios.find(x => x.id === el.dataset.id); if (s && confirm(`Load “${s.name}”? This replaces the current inputs.`)) { state.inputs = clone(s.inputs); invalidate(); persist(); toast(`Loaded “${s.name}”`); go('inputs') } break }
    case 'delete-scenario': { const s = state.scenarios.find(x => x.id === el.dataset.id); if (s && confirm(`Delete scenario “${s.name}”?`)) { state.scenarios = state.scenarios.filter(x => x.id !== s.id); scenarioSel.delete(s.id); persist(); render() } break }
    case 'csv-upload': $('#csv-file').click(); break
    case 'csv-sample': { const ta = $('#csv-text'); if (ta) ta.value = sampleCSV(); parseCalibration(); break }
    case 'csv-parse': parseCalibration(); break
    case 'run-calib': { if (!calib.runs) break; setStatus('Calibrating', 'busy'); setTimeout(() => { calib.result = calibrate(i, calib.runs, calib.keys, { alignMode: calib.align }); setStatus('Idle', ''); render() }, 10); break }
    case 'apply-calib': { if (!calib.result) break; for (const ch of calib.result.changes) i[ch.key] = +ch.to.toFixed(6); invalidate(); persist(); calib.cmp = compare(i, calib.runs, calib.align); calib.result = null; toast('Calibrated parameters applied'); render(); break }
    default: break
  }
})

/* ------------------------------------------------------------------ */
/* init                                                               */
/* ------------------------------------------------------------------ */
if (state.calibrationCSV) { try { calib.runs = groupRuns(parseCSV(state.calibrationCSV)); calib.cmp = compare(state.inputs, calib.runs, calib.align) } catch { /* ignore stale CSV */ } }
render()
