/**
 * The Lookup Record's whole privacy claim is that the address is not in the
 * store. These tests are that claim, stated as behaviour.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { OpaqueKeys } from "./OpaqueKeys.ts"
import { Storage } from "./Storage.ts"

const conceal = (layer: Layer.Layer<OpaqueKeys>, plaintext: string) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const keys = yield* OpaqueKeys
      return yield* keys.conceal(plaintext)
    }).pipe(Effect.provide(layer))
  )

const address = "https://intranet.example.com/patients/94213/notes?token=abc"

describe("concealment", () => {
  it("is deterministic within one install", async () => {
    const layer = OpaqueKeys.layerWithSalt("salt-a")
    expect(await conceal(layer, address)).toBe(await conceal(layer, address))
  })

  it("differs between installs, so nothing derived from a key is shareable", async () => {
    const a = await conceal(OpaqueKeys.layerWithSalt("salt-a"), address)
    const b = await conceal(OpaqueKeys.layerWithSalt("salt-b"), address)
    expect(a).not.toBe(b)
  })

  it("leaves no fragment of the address in the key", async () => {
    const key = await conceal(OpaqueKeys.layerWithSalt("salt-a"), address)
    for (const fragment of ["intranet", "example.com", "patients", "94213", "token", "abc", "http"]) {
      expect(key).not.toContain(fragment)
    }
  })

  it("distinguishes addresses that differ by one character", async () => {
    const layer = OpaqueKeys.layerWithSalt("salt-a")
    const a = await conceal(layer, "https://example.com/a")
    const b = await conceal(layer, "https://example.com/b")
    expect(a).not.toBe(b)
  })
})

describe("the salt outlives the worker that minted it", () => {
  it("produces the same key from a second, independently built layer", async () => {
    // The MV3 case, and the one that matters: the service worker is killed and a
    // new one builds the layer again. A salt that did not persist would mint a
    // fresh namespace, every prior Lookup Record entry would become
    // unrecognisable, and ADR 0001's "at most once per long TTL" would silently
    // become "at most once per worker lifetime".
    const backing = new Map<string, string>()
    const storage = Storage.memory(backing)

    const first = await conceal(Layer.provide(OpaqueKeys.layer, storage), address)
    const second = await conceal(Layer.provide(OpaqueKeys.layer, storage), address)

    expect(first).toBe(second)
    expect(backing.has("parle/memory/salt")).toBe(true)
  })

  it("still conceals when storage refuses to hold the salt", async () => {
    // An ephemeral salt is a degraded store, not a broken one: keys stay opaque,
    // they simply stop being recognisable after a restart.
    const layer = Layer.provide(OpaqueKeys.layer, Storage.unavailable())
    const key = await conceal(layer, address)
    expect(key.length).toBeGreaterThan(0)
    expect(key).not.toContain("example.com")
  })
})
