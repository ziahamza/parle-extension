/**
 * 32-bit math primitives for 64-bit arithmetic.
 *
 * VENDORED from `@expo/binary-fuse-filter@1.0.0` (MIT — see ./LICENSE), itself
 * a port of the C reference implementation by Thomas Mueller Graf and Daniel
 * Lemire (https://github.com/FastFilter/xor_singleheader — see
 * ./LICENSE-xor_singleheader). Both notices are retained beside this file, as
 * MIT requires and as AGPL-3.0 permits.
 *
 * Vendored rather than depended on because the published package hashes key
 * STRINGS itself and offers no way to supply precomputed 64-bit keys — see the
 * header of ./filter.ts. Nothing in this file is changed from upstream beyond
 * restoring the TypeScript annotations that the published build had erased.
 *
 * All 64-bit values are `[high, low]` pairs of unsigned 32-bit numbers, which
 * avoids BigInt; the filter is built over millions of keys and BigInt
 * allocation dominates everything else at that size.
 */

/** An unsigned 64-bit integer represented as `[high, low]` 32-bit words. */
export type Uint64 = [number, number]

/** The low 64 bits of a 64×64 unsigned multiply. */
export const mul64 = (aHigh: number, aLow: number, bHigh: number, bLow: number): Uint64 => {
  const resultLow = Math.imul(aLow, bLow) >>> 0
  const resultHigh = ((Math.imul(aHigh, bLow) + Math.imul(aLow, bHigh) + mul32hi(aLow, bLow)) & 0xffffffff) >>> 0
  return [resultHigh, resultLow]
}

/** The sum of two 64-bit unsigned integers. */
export const add64 = (aHigh: number, aLow: number, bHigh: number, bLow: number): Uint64 => {
  const low = aLow + bLow // fits in a double (< 2^33)
  const resultLow = low >>> 0
  const carry = low > 0xffffffff ? 1 : 0
  const resultHigh = ((aHigh + bHigh + carry) & 0xffffffff) >>> 0
  return [resultHigh, resultLow]
}

/**
 * The high 32 bits of a 64×32 unsigned multiply.
 *
 * Equivalent to the C expression `(uint32_t)((__uint128_t)a * b >> 64)` when
 * `b` is a `uint32_t`. The result fits in 32 bits at every filter size we
 * support.
 */
export const mulhi64x32 = (aHigh: number, aLow: number, b: number): number => {
  const lowProductHigh = mul32hi(aLow, b)
  const highProductLow = Math.imul(aHigh, b) >>> 0
  const highProductHigh = mul32hi(aHigh, b)
  const mid = lowProductHigh + highProductLow // fits in a double (< 2^33)
  const carry = mid > 0xffffffff ? 1 : 0
  return (highProductHigh + carry) >>> 0
}

/** The high 32 bits of an unsigned 32×32 multiply. */
export const mul32hi = (a: number, b: number): number => {
  const aLow = a & 0xffff
  const aHigh = a >>> 16
  const bLow = b & 0xffff
  const bHigh = b >>> 16
  const lowLow = aLow * bLow
  const lowHigh = aLow * bHigh
  const highLow = aHigh * bLow
  const highHigh = aHigh * bHigh
  const mid = (lowLow >>> 16) + (lowHigh & 0xffff) + (highLow & 0xffff)
  return ((highHigh + (lowHigh >>> 16) + (highLow >>> 16) + (mid >>> 16)) & 0xffffffff) >>> 0
}
