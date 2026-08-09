/**
 * SHA-256 is not interesting code, but it is the bottom of the artifact
 * contract: it derives every index key and it verifies every blob pin. A subtle
 * bug in it would not throw — it would produce a filter nobody can query and a
 * pin nothing can satisfy, which look from the outside like "the index is
 * always absent". So it is checked against the FIPS 180-4 vectors, and against
 * the padding boundaries where hand-written implementations actually break.
 */
import { describe, expect, it } from "vitest"
import { sha256Hex, toHex, utf8 } from "./Sha256.ts"

const bytes = (length: number, fill: number): Uint8Array => new Uint8Array(length).fill(fill)

describe("sha256", () => {
  it("matches the FIPS 180-4 vectors", () => {
    expect(sha256Hex(utf8(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    expect(sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(sha256Hex(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    )
  })

  it("pads correctly on either side of the 55/56-byte boundary", () => {
    // 55 bytes is the largest message whose 0x80 byte and 8-byte length still
    // fit in one block; 56 forces a second. Every off-by-one in padding shows
    // up here and nowhere else.
    expect(sha256Hex(bytes(55, 0x61))).toBe("9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318")
    expect(sha256Hex(bytes(56, 0x61))).toBe("b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a")
    expect(sha256Hex(bytes(64, 0x61))).toBe("ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb")
    expect(sha256Hex(bytes(119, 0x61))).toBe("31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb")
  })

  it("handles a message long enough to exercise the 64-bit length field", () => {
    // A megabyte is 8,388,608 bits — comfortably past the point where a length
    // written as a 32-bit quantity would still be right, but far enough into
    // multi-block territory to catch a state-carry bug.
    expect(sha256Hex(bytes(1_000_000, 0x61))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    )
  })

  it("renders lowercase hex, which is the only form a manifest may pin with", () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe("000fa0ff")
    expect(sha256Hex(utf8("abc"))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("utf8", () => {
  it("encodes the planes a URL can actually contain", () => {
    expect([...utf8("a")]).toEqual([0x61])
    expect([...utf8("é")]).toEqual([0xc3, 0xa9])
    expect([...utf8("✓")]).toEqual([0xe2, 0x9c, 0x93])
    // U+1D11E, outside the BMP, arrives as a surrogate pair in a JS string
    expect([...utf8("\u{1D11E}")]).toEqual([0xf0, 0x9d, 0x84, 0x9e])
  })

  it("replaces lone surrogates rather than emitting something unrepresentable", () => {
    // A URL should never contain one, but `chrome.tabs` hands us whatever the
    // page had. Saying what happens here is what lets the key derivation be
    // specified as "UTF-8" without a footnote.
    const replacement = [0xef, 0xbf, 0xbd]
    expect([...utf8("\uD800")]).toEqual(replacement)
    expect([...utf8("\uDC00")]).toEqual(replacement)
    expect([...utf8("\uD800a")]).toEqual([...replacement, 0x61])
  })
})
