/**
 * The daily increment. Small, boring, and the one place where a silently wrong
 * sort order would turn a binary search into a false negative — which is the
 * failure this package exists not to have.
 */
import { describe, expect, it } from "vitest"
import { addendumHas, deserializeAddendum, emptyAddendum, serializeAddendum } from "./Addendum.ts"
import { buildAddendum } from "./Build.ts"
import { keyOfCanonical } from "./Key.ts"

const read = (bytes: Uint8Array) => {
  const decoded = deserializeAddendum(bytes)
  if ("_tag" in decoded) throw new Error(decoded.detail)
  return decoded
}

const urls = Array.from({ length: 2_000 }, (_, i) => `https://example.com/fresh/${i}`)

describe("the addendum", () => {
  it("round-trips every key it was given", () => {
    const addendum = read(serializeAddendum(urls.map(keyOfCanonical)))
    for (const url of urls) {
      expect(addendumHas(addendum, keyOfCanonical(url)), url).toBe(true)
    }
  })

  it("sorts and deduplicates, so the bytes are a function of the key SET", () => {
    const forwards = serializeAddendum(urls.map(keyOfCanonical))
    const backwards = serializeAddendum([...urls].reverse().map(keyOfCanonical))
    const doubled = serializeAddendum([...urls, ...urls].map(keyOfCanonical))
    expect([...backwards]).toEqual([...forwards])
    expect([...doubled]).toEqual([...forwards])
  })

  it("costs four bytes a key plus a header", () => {
    const built = buildAddendum(urls)
    expect(built.bytes.length).toBe(16 + built.keyCount * 4)
    expect(built.keyCount).toBe(urls.length)
  })

  it("holds nothing when there is nothing to hold", () => {
    expect(addendumHas(emptyAddendum, keyOfCanonical("https://example.com/"))).toBe(false)
    expect(read(serializeAddendum([])).keys.length).toBe(0)
  })

  it("refuses bytes that are not an addendum", () => {
    const good = serializeAddendum(urls.map(keyOfCanonical))

    const wrongMagic = Uint8Array.from(good)
    wrongMagic[0] = 0x00
    expect(deserializeAddendum(wrongMagic)).toMatchObject({ _tag: "Unreadable" })

    const futureVersion = Uint8Array.from(good)
    futureVersion[4] = 2
    expect(deserializeAddendum(futureVersion)).toMatchObject({ _tag: "Unreadable" })

    expect(deserializeAddendum(good.slice(0, 8))).toMatchObject({ _tag: "Unreadable" })
    expect(deserializeAddendum(good.slice(0, good.length - 4))).toMatchObject({ _tag: "Unreadable" })
  })

  it("refuses keys that are not strictly ascending", () => {
    const good = serializeAddendum(urls.map(keyOfCanonical))
    const scrambled = Uint8Array.from(good)
    const view = new DataView(scrambled.buffer)
    const first = view.getUint32(16, true)
    const second = view.getUint32(20, true)
    view.setUint32(16, second, true)
    view.setUint32(20, first, true)
    expect(deserializeAddendum(scrambled)).toMatchObject({ _tag: "Unreadable" })
  })

  it("refuses an actual concatenation of two days' files", () => {
    // The check above is a swap inside ONE blob, and a real concatenation
    // satisfies it trivially: both halves are individually ascending, so
    // nothing is ever out of order. What catches a concatenation is the LENGTH,
    // because the first header says how many keys to read and a longer body
    // reads back as a valid prefix — Monday's keys, silently without Tuesday's.
    const monday = serializeAddendum(
      Array.from({ length: 100 }, (_, i) => keyOfCanonical(`https://monday.example/${i}`))
    )
    const tuesday = serializeAddendum(
      Array.from({ length: 100 }, (_, i) => keyOfCanonical(`https://tuesday.example/${i}`))
    )
    const glued = new Uint8Array(monday.length + tuesday.length)
    glued.set(monday)
    glued.set(tuesday, monday.length)

    expect(deserializeAddendum(glued)).toMatchObject({ _tag: "Unreadable" })
  })

  it("refuses a trailing byte, however innocent", () => {
    const good = serializeAddendum([keyOfCanonical("https://example.com/one")])
    const padded = new Uint8Array(good.length + 1)
    padded.set(good)
    expect(deserializeAddendum(padded)).toMatchObject({ _tag: "Unreadable" })
  })

  it("reads a blob that arrived as a view into a larger buffer", () => {
    // What `fetch` → `arrayBuffer` → a pooled Node Buffer hands you. If the
    // deserializer read from byte zero of the backing buffer instead of from
    // the view, every one of these tests would still pass and the extension
    // would refuse every addendum it ever downloaded.
    const good = serializeAddendum(urls.slice(0, 50).map(keyOfCanonical))
    const pool = new Uint8Array(good.length + 9)
    pool.set(good, 9)
    const decoded = read(new Uint8Array(pool.buffer, 9, good.length))
    expect(decoded.keys.length).toBe(50)
  })
})
