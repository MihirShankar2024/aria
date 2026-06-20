/**
 * Exact rational arithmetic for beat accounting. Tuplets divide beats into thirds,
 * fifths, sevenths, etc.; summing those as floats drifts (3 × 1/3 ≠ 1.0), so capacity
 * and fullness checks accumulate Rationals and compare exactly. Kept tiny and local —
 * the written note value stays the `Duration` enum; this only powers beat math.
 */
export interface Rational {
  num: number
  den: number
}

/** Greatest common divisor of two integers (1 when both are 0). */
export function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a || 1
}

/** Construct a normalized (reduced, positive-denominator) rational. */
export function r(num: number, den = 1): Rational {
  if (den === 0) throw new Error('rational denominator is zero')
  if (den < 0) {
    num = -num
    den = -den
  }
  const g = gcd(num, den)
  return { num: num / g, den: den / g }
}

export function add(a: Rational, b: Rational): Rational {
  return r(a.num * b.den + b.num * a.den, a.den * b.den)
}

export function sub(a: Rational, b: Rational): Rational {
  return r(a.num * b.den - b.num * a.den, a.den * b.den)
}

export function mul(a: Rational, b: Rational): Rational {
  return r(a.num * b.num, a.den * b.den)
}

export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0) throw new Error('rational division by zero')
  return r(a.num * b.den, a.den * b.num)
}

export function toFloat(a: Rational): number {
  return a.num / a.den
}

export function equals(a: Rational, b: Rational): boolean {
  // Both are normalized, so component equality is exact equality.
  return a.num === b.num && a.den === b.den
}

/** a <= b */
export function lte(a: Rational, b: Rational): boolean {
  return a.num * b.den <= b.num * a.den
}
