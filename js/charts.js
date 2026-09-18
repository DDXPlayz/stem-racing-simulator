/**
 * Lightweight SVG charts. No dependencies. Every chart is responsive
 * (viewBox + width:100%) and the line charts have a hover crosshair.
 */

export const COLORS = ['#D40000', '#FFFBF8', '#F5A524', '#4FC3F7', '#43D17C', '#B388FF', '#FF7043']
const INK = 'rgba(255,251,248,0.72)', GRID = 'rgba(255,251,248,0.08)', AXIS = 'rgba(255,251,248,0.3)'
const FONT = "font-family:'Orbitron','Segoe UI',sans-serif;font-size:10px;letter-spacing:.06em"

const svgEl = (tag, attrs = {}, parent = null) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v)
  if (parent) parent.appendChild(el)
  return el
}

export function niceTicks(min, max, n = 5) {
  if (!(max > min)) { max = min + 1 }
  const span = max - min
  const raw = span / n
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const ticks = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10))
  return ticks
}

const fmtDefault = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2))

function frame(el, { w = 720, h = 320, pad = { l: 56, r: 18, t: 16, b: 40 } } = {}) {
  el.innerHTML = ''
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', class: 'chart', role: 'img', style: 'height:auto;display:block' }, el)
  return { svg, w, h, pad, iw: w - pad.l - pad.r, ih: h - pad.t - pad.b }
}

function axes(F, xs, ys, { xLabel, yLabel, xFmt = fmtDefault, yFmt = fmtDefault, xTicks, yTicks }) {
  const { svg, pad, iw, ih } = F
  const g = svgEl('g', {}, svg)
  for (const t of yTicks) {
    const y = ys(t)
    svgEl('line', { x1: pad.l, x2: pad.l + iw, y1: y, y2: y, stroke: GRID }, g)
    const tx = svgEl('text', { x: pad.l - 8, y: y + 3, fill: INK, 'text-anchor': 'end', style: FONT }, g); tx.textContent = yFmt(t)
  }
  for (const t of xTicks) {
    const x = xs(t)
    svgEl('line', { x1: x, x2: x, y1: pad.t, y2: pad.t + ih, stroke: GRID }, g)
    const tx = svgEl('text', { x, y: pad.t + ih + 16, fill: INK, 'text-anchor': 'middle', style: FONT }, g); tx.textContent = xFmt(t)
  }
  svgEl('line', { x1: pad.l, x2: pad.l + iw, y1: pad.t + ih, y2: pad.t + ih, stroke: AXIS }, g)
  svgEl('line', { x1: pad.l, x2: pad.l, y1: pad.t, y2: pad.t + ih, stroke: AXIS }, g)
  if (xLabel) { const t = svgEl('text', { x: pad.l + iw / 2, y: F.h - 6, fill: INK, 'text-anchor': 'middle', style: FONT }, g); t.textContent = xLabel }
  if (yLabel) { const t = svgEl('text', { x: 12, y: pad.t + ih / 2, fill: INK, 'text-anchor': 'middle', transform: `rotate(-90 12 ${pad.t + ih / 2})`, style: FONT }, g); t.textContent = yLabel }
}

function legend(F, series) {
  if (series.length < 2) return
  const g = svgEl('g', {}, F.svg)
  let x = F.pad.l + 6
  series.forEach((s, i) => {
    const c = s.color || COLORS[i % COLORS.length]
    svgEl('rect', { x, y: F.pad.t + 2, width: 10, height: 3, fill: c }, g)
    const t = svgEl('text', { x: x + 14, y: F.pad.t + 7, fill: INK, style: FONT }, g); t.textContent = s.name
    x += 14 + s.name.length * 7 + 16
  })
}

/**
 * Multi-series line chart.
 * series: [{ name, points: [[x, y], …], color, dash, step }]
 * markers: vertical lines [{ x, label, color }]
 * bands:   shaded x-ranges [{ x0, x1, label, color }]
 */
export function lineChart(el, { series, xLabel, yLabel, xFmt, yFmt, markers = [], bands = [], yMin, yMax, xMin, xMax, tooltip = true }) {
  const F = frame(el)
  const pts = series.flatMap(s => s.points)
  if (!pts.length) { el.innerHTML = '<div class="chart-empty">No data yet</div>'; return }
  const x0 = xMin ?? Math.min(...pts.map(p => p[0])), x1 = xMax ?? Math.max(...pts.map(p => p[0]))
  let y0 = yMin ?? Math.min(...pts.map(p => p[1])), y1 = yMax ?? Math.max(...pts.map(p => p[1]))
  if (yMin == null && y0 > 0 && y0 < (y1 - y0) * 0.5) y0 = 0
  if (y1 === y0) y1 = y0 + 1
  const yT = niceTicks(y0, y1, 5); y0 = Math.min(y0, yT[0]); y1 = Math.max(y1, yT[yT.length - 1])
  const xT = niceTicks(x0, x1, 6)
  const xs = v => F.pad.l + ((v - x0) / (x1 - x0 || 1)) * F.iw
  const ys = v => F.pad.t + F.ih - ((v - y0) / (y1 - y0 || 1)) * F.ih
  for (const b of bands) {
    svgEl('rect', { x: xs(b.x0), y: F.pad.t, width: Math.max(0, xs(b.x1) - xs(b.x0)), height: F.ih, fill: b.color || 'rgba(255,251,248,0.04)' }, F.svg)
    if (b.label) { const t = svgEl('text', { x: (xs(b.x0) + xs(b.x1)) / 2, y: F.pad.t + F.ih - 6, fill: 'rgba(255,251,248,0.4)', 'text-anchor': 'middle', style: FONT }, F.svg); t.textContent = b.label }
  }
  axes(F, xs, ys, { xLabel, yLabel, xFmt, yFmt, xTicks: xT.filter(t => t >= x0 && t <= x1), yTicks: yT })
  series.forEach((s, i) => {
    if (!s.points.length) return
    const c = s.color || COLORS[i % COLORS.length]
    const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${xs(p[0]).toFixed(1)},${ys(Math.min(y1, Math.max(y0, p[1]))).toFixed(1)}`).join(' ')
    svgEl('path', { d, fill: 'none', stroke: c, 'stroke-width': s.width || 2, 'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round' }, F.svg)
    if (s.dots) for (const p of s.points) svgEl('circle', { cx: xs(p[0]), cy: ys(p[1]), r: 3, fill: c }, F.svg)
  })
  for (const m of markers) {
    const x = xs(m.x)
    svgEl('line', { x1: x, x2: x, y1: F.pad.t, y2: F.pad.t + F.ih, stroke: m.color || '#F5A524', 'stroke-dasharray': '4 3' }, F.svg)
    if (m.label) { const t = svgEl('text', { x: x + 4, y: F.pad.t + 12, fill: m.color || '#F5A524', style: FONT }, F.svg); t.textContent = m.label }
  }
  legend(F, series)
  if (tooltip) hover(F, el, series, xs, ys, x0, x1, xFmt || fmtDefault, yFmt || fmtDefault)
}

function hover(F, el, series, xs, ys, x0, x1, xFmt, yFmt) {
  const g = svgEl('g', { style: 'display:none', 'pointer-events': 'none' }, F.svg)
  const line = svgEl('line', { y1: F.pad.t, y2: F.pad.t + F.ih, stroke: 'rgba(255,251,248,0.5)' }, g)
  const dots = series.map((s, i) => svgEl('circle', { r: 4, fill: s.color || COLORS[i % COLORS.length], stroke: '#000', 'stroke-width': 1.5 }, g))
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; el.appendChild(tip)
  el.style.position = 'relative'
  const find = (pts, x) => { let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] < x) lo = m; else hi = m } return Math.abs(pts[lo][0] - x) < Math.abs(pts[hi][0] - x) ? pts[lo] : pts[hi] }
  F.svg.addEventListener('mousemove', e => {
    const r = F.svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * F.w
    if (px < F.pad.l || px > F.pad.l + F.iw) { g.style.display = 'none'; tip.hidden = true; return }
    const xv = x0 + ((px - F.pad.l) / F.iw) * (x1 - x0)
    g.style.display = ''
    line.setAttribute('x1', px); line.setAttribute('x2', px)
    let html = `<div class="tip-x">${xFmt(xv)}</div>`
    series.forEach((s, i) => {
      if (!s.points.length) { dots[i].style.display = 'none'; return }
      const p = find(s.points, xv)
      dots[i].style.display = ''
      dots[i].setAttribute('cx', xs(p[0])); dots[i].setAttribute('cy', ys(p[1]))
      html += `<div><i style="background:${s.color || COLORS[i % COLORS.length]}"></i>${s.name}: <b>${yFmt(p[1])}</b></div>`
    })
    tip.innerHTML = html; tip.hidden = false
    const left = ((px - F.pad.l) / F.iw) > 0.65 ? `calc(${(px / F.w) * 100}% - ${tip.offsetWidth + 12}px)` : `calc(${(px / F.w) * 100}% + 12px)`
    tip.style.left = left; tip.style.top = `${((e.clientY - r.top) / r.height) * 100}%`
  })
  F.svg.addEventListener('mouseleave', () => { g.style.display = 'none'; tip.hidden = true })
}

/** Vertical bars. items: [{ label, value, color, sub }] */
export function barChart(el, { items, yLabel, yFmt = fmtDefault, yMin = 0, line = null, lineLabel }) {
  const F = frame(el, { h: 300 })
  if (!items.length) { el.innerHTML = '<div class="chart-empty">No data yet</div>'; return }
  const vals = items.map(i => i.value)
  let y0 = Math.min(yMin, ...vals), y1 = Math.max(...vals, line ?? -Infinity)
  const yT = niceTicks(y0, y1 === y0 ? y0 + 1 : y1, 5); y0 = Math.min(y0, yT[0]); y1 = Math.max(y1, yT[yT.length - 1])
  const ys = v => F.pad.t + F.ih - ((v - y0) / (y1 - y0 || 1)) * F.ih
  const bw = F.iw / items.length
  axes(F, () => 0, ys, { yLabel, yFmt, xTicks: [], yTicks: yT })
  items.forEach((it, i) => {
    const x = F.pad.l + i * bw + bw * 0.15
    const y = ys(Math.max(it.value, y0))
    const rect = svgEl('rect', { x, y, width: bw * 0.7, height: Math.max(0, ys(y0) - y), fill: it.color || COLORS[0], rx: 2 }, F.svg)
    const title = svgEl('title', {}, rect); title.textContent = `${it.label}: ${yFmt(it.value)}`
    const t = svgEl('text', { x: x + bw * 0.35, y: F.pad.t + F.ih + 16, fill: INK, 'text-anchor': 'middle', style: FONT }, F.svg); t.textContent = it.label
    const v = svgEl('text', { x: x + bw * 0.35, y: y - 5, fill: '#fff', 'text-anchor': 'middle', style: FONT }, F.svg); v.textContent = yFmt(it.value)
  })
  if (line != null) {
    svgEl('line', { x1: F.pad.l, x2: F.pad.l + F.iw, y1: ys(line), y2: ys(line), stroke: '#F5A524', 'stroke-dasharray': '5 4' }, F.svg)
    if (lineLabel) { const t = svgEl('text', { x: F.pad.l + F.iw - 4, y: ys(line) - 5, fill: '#F5A524', 'text-anchor': 'end', style: FONT }, F.svg); t.textContent = lineLabel }
  }
}

/** Histogram of a numeric sample with optional vertical markers. */
export function histogramChart(el, { hist, xLabel, xFmt = v => v.toFixed(2), markers = [], color = COLORS[0] }) {
  const F = frame(el)
  if (!hist.counts.length) { el.innerHTML = '<div class="chart-empty">Run a Monte Carlo analysis to see the distribution</div>'; return }
  const x0 = hist.edges[0], x1 = hist.edges[hist.edges.length - 1]
  const n = hist.counts.reduce((a, b) => a + b, 0)
  const y1 = Math.max(...hist.counts) / n * 100
  const yT = niceTicks(0, y1, 4)
  const xs = v => F.pad.l + ((v - x0) / (x1 - x0 || 1)) * F.iw
  const ys = v => F.pad.t + F.ih - (v / (yT[yT.length - 1] || 1)) * F.ih
  axes(F, xs, ys, { xLabel, yLabel: '% of simulations', xFmt, yFmt: v => v.toFixed(0), xTicks: niceTicks(x0, x1, 6).filter(t => t >= x0 && t <= x1), yTicks: yT })
  hist.counts.forEach((c, i) => {
    const pct = (c / n) * 100
    const x = xs(hist.edges[i]), w = Math.max(1, xs(hist.edges[i + 1]) - x - 1)
    const r = svgEl('rect', { x, y: ys(pct), width: w, height: Math.max(0, ys(0) - ys(pct)), fill: color, opacity: 0.85 }, F.svg)
    const t = svgEl('title', {}, r); t.textContent = `${xFmt(hist.edges[i])} – ${xFmt(hist.edges[i + 1])}: ${c} (${pct.toFixed(1)} %)`
  })
  markers.forEach((m, i) => {
    if (m.x < x0 || m.x > x1) return
    const x = xs(m.x)
    svgEl('line', { x1: x, x2: x, y1: F.pad.t, y2: F.pad.t + F.ih, stroke: m.color || COLORS[(i + 2) % COLORS.length], 'stroke-dasharray': '4 3', 'stroke-width': 1.5 }, F.svg)
    const t = svgEl('text', { x: x + 4, y: F.pad.t + 12 + (i % 3) * 12, fill: m.color || COLORS[(i + 2) % COLORS.length], style: FONT }, F.svg); t.textContent = m.label
  })
}

/** Horizontal signed bars (tornado). items: [{ label, low, high }] sorted already. */
export function tornadoChart(el, { items, fmt = v => (v >= 0 ? '+' : '') + v.toFixed(3) + ' s', lowLabel = '−5 %', highLabel = '+5 %' }) {
  const rowH = 28
  const F = frame(el, { h: 40 + items.length * rowH, pad: { l: 170, r: 70, t: 24, b: 16 } })
  if (!items.length) { el.innerHTML = '<div class="chart-empty">No data</div>'; return }
  const m = Math.max(1e-6, ...items.flatMap(i => [Math.abs(i.low), Math.abs(i.high)]))
  const cx = F.pad.l + F.iw / 2
  const xs = v => cx + (v / m) * (F.iw / 2)
  svgEl('line', { x1: cx, x2: cx, y1: F.pad.t - 6, y2: F.pad.t + items.length * rowH, stroke: AXIS }, F.svg)
  const lg = svgEl('g', {}, F.svg)
  svgEl('rect', { x: F.pad.l, y: 4, width: 10, height: 8, fill: COLORS[3] }, lg); let t = svgEl('text', { x: F.pad.l + 14, y: 11, fill: INK, style: FONT }, lg); t.textContent = lowLabel
  svgEl('rect', { x: F.pad.l + 90, y: 4, width: 10, height: 8, fill: COLORS[0] }, lg); t = svgEl('text', { x: F.pad.l + 104, y: 11, fill: INK, style: FONT }, lg); t.textContent = highLabel
  t = svgEl('text', { x: cx, y: F.pad.t - 10, fill: INK, 'text-anchor': 'middle', style: FONT }, lg); t.textContent = 'Δ race time (faster ◄ | ► slower)'
  items.forEach((it, i) => {
    const y = F.pad.t + i * rowH + 4
    const lab = svgEl('text', { x: F.pad.l - 10, y: y + 13, fill: '#fff', 'text-anchor': 'end', style: FONT }, F.svg); lab.textContent = it.label
    for (const [v, c] of [[it.low, COLORS[3]], [it.high, COLORS[0]]]) {
      const x = Math.min(cx, xs(v)), w = Math.abs(xs(v) - cx)
      const r = svgEl('rect', { x, y, width: Math.max(1, w), height: rowH - 10, fill: c, opacity: 0.9, rx: 2 }, F.svg)
      const tt = svgEl('title', {}, r); tt.textContent = `${it.label}: ${fmt(v)}`
    }
    const vt = svgEl('text', { x: F.pad.l + F.iw + 6, y: y + 13, fill: INK, style: FONT }, F.svg); vt.textContent = fmt(Math.max(Math.abs(it.low), Math.abs(it.high)) * Math.sign(it.high || 1))
  })
}

/** KPI scores as horizontal bars against a 100 target line. items: [{ label, score, value, targetText }] */
export function kpiChart(el, { items }) {
  const rowH = 30
  const F = frame(el, { h: 30 + items.length * rowH, pad: { l: 130, r: 120, t: 20, b: 10 } })
  const xs = v => F.pad.l + (Math.min(100, Math.max(0, v)) / 100) * F.iw
  for (const tick of [0, 25, 50, 75, 100]) {
    svgEl('line', { x1: xs(tick), x2: xs(tick), y1: F.pad.t - 4, y2: F.pad.t + items.length * rowH, stroke: tick === 100 ? '#F5A524' : GRID, 'stroke-dasharray': tick === 100 ? '4 3' : null }, F.svg)
    const t = svgEl('text', { x: xs(tick), y: F.pad.t - 8, fill: tick === 100 ? '#F5A524' : INK, 'text-anchor': 'middle', style: FONT }, F.svg); t.textContent = tick === 100 ? 'target' : tick
  }
  items.forEach((it, i) => {
    const y = F.pad.t + i * rowH + 6
    const lab = svgEl('text', { x: F.pad.l - 10, y: y + 13, fill: '#fff', 'text-anchor': 'end', style: FONT }, F.svg); lab.textContent = it.label
    svgEl('rect', { x: F.pad.l, y, width: F.iw, height: rowH - 12, fill: 'rgba(255,251,248,0.06)', rx: 2 }, F.svg)
    const c = it.score >= 90 ? '#43D17C' : it.score >= 70 ? '#F5A524' : '#D40000'
    svgEl('rect', { x: F.pad.l, y, width: Math.max(0, xs(it.score) - F.pad.l), height: rowH - 12, fill: c, rx: 2 }, F.svg)
    const vt = svgEl('text', { x: F.pad.l + F.iw + 8, y: y + 13, fill: INK, style: FONT }, F.svg); vt.textContent = `${it.score.toFixed(0)} · ${it.valueText}`
  })
}
