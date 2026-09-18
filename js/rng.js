/**
 * STOCHASTIC LAYER · seeded random numbers.
 *
 * Every simulation is driven by one PRNG seeded from a 32-bit integer so a
 * race can be reproduced exactly from its seed. sfc32 is used because it is
 * fast, has a 128-bit state and passes PractRand far beyond anything this
 * tool needs.
 */

/** Turn any string/number into a 32-bit unsigned seed. */
export function toSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0
  const s = String(value ?? '')
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** A fresh random seed from the browser's entropy source. */
export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const a = new Uint32Array(1)
    globalThis.crypto.getRandomValues(a)
    return a[0]
  }
  return (Math.random() * 4294967296) >>> 0
}

export class RNG {
  constructor(seed = 1) {
    this.seed = toSeed(seed)
    // splitmix-style expansion of the 32-bit seed into a 128-bit sfc32 state
    let s = this.seed
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
      return (z ^ (z >>> 16)) >>> 0
    }
    this.a = next(); this.b = next(); this.c = next(); this.d = 1
    for (let i = 0; i < 12; i++) this.next()
    this._spare = null
  }

  /** Uniform in [0, 1). */
  next() {
    let { a, b, c, d } = this
    const t = (((a + b) >>> 0) + d) >>> 0
    d = (d + 1) >>> 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) >>> 0
    c = ((c << 21) | (c >>> 11)) >>> 0
    c = (c + t) >>> 0
    this.a = a; this.b = b; this.c = c; this.d = d
    return t / 4294967296
  }

  uniform(min = 0, max = 1) { return min + (max - min) * this.next() }

  /** Standard normal via Marsaglia polar method. */
  gauss() {
    if (this._spare !== null) { const v = this._spare; this._spare = null; return v }
    let u, v, s
    do { u = this.next() * 2 - 1; v = this.next() * 2 - 1; s = u * u + v * v } while (s >= 1 || s === 0)
    const m = Math.sqrt(-2 * Math.log(s) / s)
    this._spare = v * m
    return u * m
  }

  normal(mean, sd) { return mean + sd * this.gauss() }

  /** Normal clipped to [min, max] (re-sampled up to 8×, then clamped). */
  truncNormal(mean, sd, min = -Infinity, max = Infinity) {
    if (sd <= 0) return Math.min(max, Math.max(min, mean))
    for (let i = 0; i < 8; i++) {
      const x = this.normal(mean, sd)
      if (x >= min && x <= max) return x
    }
    return Math.min(max, Math.max(min, this.normal(mean, sd)))
  }

  /** Log-normal parameterised by the mean and sd of the *result* (not of log). */
  lognormal(mean, sd) {
    if (sd <= 0 || mean <= 0) return mean
    const s2 = Math.log(1 + (sd * sd) / (mean * mean))
    const mu = Math.log(mean) - s2 / 2
    return Math.exp(mu + Math.sqrt(s2) * this.gauss())
  }

  bernoulli(p) { return this.next() < p }

  /** Multiplicative noise: 1 + N(0, cv), clipped so it can never go ≤ 0. */
  factor(cv) { return Math.max(0.05, 1 + cv * this.gauss()) }

  /** Derive an independent child stream (for per-run or per-simulation seeds). */
  child(index) { return new RNG(toSeed(`${this.seed}:${index}`)) }
}
