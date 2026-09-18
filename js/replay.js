/**
 * PRESENTATION · race replay on an SVG track with a phase timeline.
 * Drives a playhead through the recorded trace of one run (or the whole
 * race) and reports the interpolated telemetry to a callback.
 */
import { PHASE_LABEL } from './engine.js'

export const PHASE_COLORS = { reaction: '#4FC3F7', launch: '#F5A524', acceleration: '#D40000', highSpeed: '#FF7043', braking: '#B388FF', transition: 'rgba(255,251,248,.25)' }

/** Interpolate the trace at time t (trace must be time-ordered). */
export function sampleTrace(trace, t) {
  if (!trace?.length) return null
  if (t <= trace[0].t) return trace[0]
  if (t >= trace[trace.length - 1].t) return trace[trace.length - 1]
  let lo = 0, hi = trace.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (trace[m].t <= t) lo = m; else hi = m }
  const a = trace[lo], b = trace[hi], w = (t - a.t) / Math.max(1e-12, b.t - a.t)
  return { t, x: a.x + (b.x - a.x) * w, v: a.v + (b.v - a.v) * w, a: a.a + (b.a - a.a) * w, phase: a.phase, Ft: a.Ft, Fd: a.Fd, Fr: a.Fr }
}

/** Phase segments [{phase, t0, t1}] from a trace. */
export function phaseSegments(trace) {
  const segs = []
  for (const p of trace) {
    const last = segs[segs.length - 1]
    if (!last || last.phase !== p.phase) segs.push({ phase: p.phase, t0: p.t, t1: p.t })
    else last.t1 = p.t
  }
  return segs
}

/** Draw the track and car at distance x. Returns the SVG markup string. */
export function trackSVG(inputs, x, phase, { finished = false } = {}) {
  const total = inputs.trackLength + inputs.brakingZone
  const W = 1000, H = 150, padL = 40, padR = 40
  const sx = d => padL + (Math.min(total, Math.max(0, d)) / total) * (W - padL - padR)
  const finish = sx(inputs.trackLength), launch = sx(inputs.launchZone), end = sx(total)
  const carX = sx(x)
  const col = PHASE_COLORS[phase] || '#fff'
  const ticks = []
  const step = total > 30 ? 5 : total > 12 ? 2 : 1
  for (let d = 0; d <= total + 1e-9; d += step) ticks.push(`<line x1="${sx(d)}" x2="${sx(d)}" y1="96" y2="104" stroke="rgba(255,251,248,.35)"/><text x="${sx(d)}" y="118" fill="rgba(255,251,248,.5)" text-anchor="middle" font-family="Orbitron" font-size="9">${d} m</text>`)
  return `<svg viewBox="0 0 ${W} ${H}" class="track-view" role="img" aria-label="Track with car at ${x.toFixed(2)} m">
    <rect x="${padL}" y="40" width="${end - padL}" height="56" fill="rgba(255,251,248,.04)" stroke="rgba(255,251,248,.15)"/>
    <rect x="${padL}" y="40" width="${launch - padL}" height="56" fill="rgba(245,165,36,.08)"/>
    <rect x="${finish}" y="40" width="${end - finish}" height="56" fill="rgba(179,136,255,.10)"/>
    <line x1="${padL}" x2="${end}" y1="68" y2="68" stroke="rgba(255,251,248,.25)" stroke-dasharray="6 6"/>
    <line x1="${padL}" x2="${padL}" y1="30" y2="106" stroke="#43D17C" stroke-width="2"/>
    <text x="${padL}" y="22" fill="#43D17C" text-anchor="middle" font-family="Orbitron" font-size="9" letter-spacing="1">START</text>
    <text x="${(padL + launch) / 2}" y="34" fill="rgba(245,165,36,.8)" text-anchor="middle" font-family="Orbitron" font-size="8" letter-spacing="1">LAUNCH ZONE</text>
    ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${finish - 4}" y="${40 + i * 9.33}" width="4" height="9.33" fill="${i % 2 ? '#fff' : '#000'}"/><rect x="${finish}" y="${40 + i * 9.33}" width="4" height="9.33" fill="${i % 2 ? '#000' : '#fff'}"/>`).join('')}
    <text x="${finish}" y="22" fill="#fff" text-anchor="middle" font-family="Orbitron" font-size="9" letter-spacing="1">FINISH · ${inputs.trackLength} m</text>
    <text x="${(finish + end) / 2}" y="34" fill="rgba(179,136,255,.9)" text-anchor="middle" font-family="Orbitron" font-size="8" letter-spacing="1">BRAKING ZONE · ${inputs.brakingZone} m</text>
    <line x1="${end}" x2="${end}" y1="30" y2="106" stroke="#D40000" stroke-width="3"/>
    ${ticks.join('')}
    <g transform="translate(${carX} 68)">
      <ellipse cx="-14" cy="0" rx="34" ry="8" fill="${col}" opacity=".18"/>
      <path d="M-26,-7 L14,-7 L22,-3 L22,3 L14,7 L-26,7 L-30,3 L-30,-3 Z" fill="${col}" stroke="#000" stroke-width="1"/>
      <rect x="-22" y="-10" width="8" height="20" fill="#111"/><rect x="6" y="-10" width="8" height="20" fill="#111"/>
      <text x="0" y="-16" fill="#fff" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11">${x.toFixed(2)} m</text>
    </g>
    ${finished ? `<text x="${end - 6}" y="140" fill="#43D17C" text-anchor="end" font-family="Orbitron" font-size="10" letter-spacing="2">RUN COMPLETE</text>` : ''}
  </svg>`
}

/** Timeline bar HTML for a run's phase segments with a cursor at t. */
export function timelineHTML(segs, t, tEnd) {
  const total = Math.max(1e-9, tEnd)
  const inner = segs.map(s => `<span style="width:${((s.t1 - s.t0) / total) * 100}%;background:${PHASE_COLORS[s.phase]}" title="${PHASE_LABEL[s.phase]} ${(s.t1 - s.t0).toFixed(3)} s">${((s.t1 - s.t0) / total) > 0.1 ? PHASE_LABEL[s.phase] : ''}</span>`).join('')
  return `<div class="timeline">${inner}<div class="cursor" style="left:${Math.min(100, (t / total) * 100)}%"></div></div>`
}

/**
 * Replay controller. Calls onFrame(t) on every animation frame while playing.
 */
export class Replayer {
  constructor({ duration, onFrame, onEnd }) {
    this.duration = duration; this.onFrame = onFrame; this.onEnd = onEnd
    this.t = 0; this.speed = 1; this.playing = false; this._raf = null; this._last = 0
  }
  play() { if (this.playing) return; if (this.t >= this.duration) this.t = 0; this.playing = true; this._last = performance.now(); this._tick() }
  pause() { this.playing = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = null }
  restart() { this.pause(); this.t = 0; this.onFrame(0); this.play() }
  seek(t) { this.t = Math.min(this.duration, Math.max(0, t)); this.onFrame(this.t) }
  setSpeed(s) { this.speed = s }
  destroy() { this.pause() }
  _tick() {
    if (!this.playing) return
    this._raf = requestAnimationFrame(now => {
      const dt = (now - this._last) / 1000; this._last = now
      this.t = Math.min(this.duration, this.t + dt * this.speed)
      this.onFrame(this.t)
      if (this.t >= this.duration) { this.playing = false; this.onEnd?.() } else this._tick()
    })
  }
}
