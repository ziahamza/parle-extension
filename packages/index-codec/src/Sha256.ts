/**
 * SHA-256, in plain TypeScript, synchronously.
 *
 * Two jobs, and neither tolerates the obvious alternative.
 *
 * **Key derivation.** Every probe of the Discussion Index starts by hashing a
 * Subject URL. `crypto.subtle.digest` is asynchronous, so using it would make a
 * membership test an `await` — on a path the reader is waiting behind, at
 * roughly three million probes per second of theoretical throughput. A promise
 * per probe would dominate the filter by orders of magnitude. This is
 * synchronous and takes microseconds on a URL-sized input.
 *
 * **Pinning.** The manifest pins each artifact by `sha256` and the client must
 * check it before trusting a blob. That check runs over about four megabytes,
 * which this does in a few tens of milliseconds — once per artifact refresh,
 * not per probe. Slower than WebCrypto, and irrelevant at that cadence.
 *
 * There is a third, quieter reason: ADR 0010 promises anyone can rebuild these
 * artifacts, and SHA-256 is the one hash every language already agrees on. It
 * is written out here so the key derivation in ./Key.ts can be specified as
 * "SHA-256, FIPS 180-4" and mean it, rather than "whatever the runtime called
 * SHA-256 that day".
 *
 * Verified against the FIPS 180-4 vectors and against multi-block, unaligned
 * and length-boundary inputs in ./Sha256.test.ts.
 */

/** Round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2
])

/** Initial state: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])

const at = (words: Uint32Array, i: number): number => words[i] ?? 0

/**
 * The 32-byte SHA-256 digest of some bytes.
 *
 * Allocates one padded copy of the input. For the four-megabyte artifact that
 * is a four-megabyte allocation; acceptable at refresh cadence, and the
 * alternative — a streaming API — would buy nothing, since the caller already
 * holds the whole blob in memory to deserialize it.
 */
export const sha256 = (message: Uint8Array): Uint8Array => {
  const bitLength = message.length * 8
  // One 0x80 byte, then zeroes, then an 8-byte big-endian bit count, rounded up
  // to a whole number of 64-byte blocks.
  const paddedLength = (message.length + 9 + 63) & ~63
  const block = new Uint8Array(paddedLength)
  block.set(message)
  block[message.length] = 0x80

  const view = new DataView(block.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const h = new Uint32Array(H0)
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i++) {
      const w15 = at(w, i - 15)
      const w2 = at(w, i - 2)
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      w[i] = (at(w, i - 16) + s0 + at(w, i - 7) + s1) >>> 0
    }

    let a = at(h, 0)
    let b = at(h, 1)
    let c = at(h, 2)
    let d = at(h, 3)
    let e = at(h, 4)
    let f = at(h, 5)
    let g = at(h, 6)
    let hh = at(h, 7)

    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + at(K, i) + at(w, i)) >>> 0
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0

      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h[0] = (at(h, 0) + a) >>> 0
    h[1] = (at(h, 1) + b) >>> 0
    h[2] = (at(h, 2) + c) >>> 0
    h[3] = (at(h, 3) + d) >>> 0
    h[4] = (at(h, 4) + e) >>> 0
    h[5] = (at(h, 5) + f) >>> 0
    h[6] = (at(h, 6) + g) >>> 0
    h[7] = (at(h, 7) + hh) >>> 0
  }

  const digest = new Uint8Array(32)
  const digestView = new DataView(digest.buffer)
  for (let i = 0; i < 8; i++) {
    digestView.setUint32(i * 4, at(h, i), false)
  }
  return digest
}

const HEX = "0123456789abcdef"

/** Lowercase hex, which is the only form a manifest may pin with. */
export const toHex = (bytes: Uint8Array): string => {
  let out = ""
  for (const byte of bytes) {
    out += HEX[byte >>> 4] ?? "0"
    out += HEX[byte & 0xf] ?? "0"
  }
  return out
}

/** The lowercase hex SHA-256 of some bytes. What a manifest pin is compared against. */
export const sha256Hex = (message: Uint8Array): string => toHex(sha256(message))

/**
 * UTF-8 bytes of a string.
 *
 * Written out rather than reaching for `TextEncoder` because the key derivation
 * is part of a wire format that a Rust or Python rebuild must reproduce, and
 * "UTF-8" is only unambiguous if lone surrogates are handled explicitly. An
 * unpaired surrogate becomes U+FFFD, which is what `TextEncoder` does and what
 * every other conformant encoder does; saying so here means a reimplementation
 * has nothing to guess.
 */
export const utf8 = (input: string): Uint8Array => {
  const out: Array<number> = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      } else {
        code = 0xfffd
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd
    }

    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }
  }
  return new Uint8Array(out)
}
