/**
 * The reader's credentials: what is stored, what can never be printed, and what
 * "connected" actually means.
 *
 * Three properties are asserted here and each one is a promise the settings
 * page makes in words.
 *
 * **A key survives a round trip through the store.** It is the only setting
 * whose loss is silent — the panel would simply say nothing is connected — so
 * the document is written and read back rather than trusted.
 *
 * **A key cannot be serialised by accident.** `Redacted` is what makes that
 * structural rather than a rule people remember, and the check is over
 * `JSON.stringify` of the whole settings value, because that is what a log
 * line, a span attribute and a `postMessage` all do.
 *
 * **Choosing a Provider and having one are different facts.** A reader who
 * picked "an API key of my own" and pasted nothing has connected nothing, and
 * telling them their key was rejected would be blaming them for a key they
 * never gave.
 */
import { describe, expect, it } from "vitest"
import * as Redacted from "effect/Redacted"
import {
  asDocument,
  firstRun,
  fromDocument,
  isSet,
  withByok,
  withCodex,
  withoutProviderKey,
  withProviderConnection
} from "../settings/Settings.ts"
import {
  baseUrlOf,
  connectionOf,
  DEFAULT_BASE_URL,
  DEFAULT_BYOK_MODEL,
  isConnected,
  PROVIDER_NAMES,
  providerFor
} from "./Connected.ts"

const KEY = "sk-test-0123456789"

const connected = withProviderConnection(
  withByok(firstRun, { apiKey: KEY, model: "some-model" }),
  "byok"
)

describe("what is stored", () => {
  it("keeps a key across a round trip through the document", () => {
    const back = fromDocument(asDocument(connected))
    expect(Redacted.value(back.provider.byok.apiKey)).toBe(KEY)
    expect(back.provider.byok.model).toBe("some-model")
    expect(back.provider.connection).toBe("byok")
  })

  it("cannot be printed, whatever prints it", () => {
    // The three ways a secret actually escapes: a log line, an interpolation,
    // and anything that structured-clones or serialises the settings value.
    expect(JSON.stringify(connected)).not.toContain(KEY)
    expect(`${connected.provider.byok.apiKey}`).not.toContain(KEY)
    expect(JSON.stringify(connected.provider)).toContain("<redacted>")

    // And the one function that is allowed to unwrap does, or nothing would
    // ever be persisted. That asymmetry is the whole design.
    expect(asDocument(connected)).toContain(KEY)
  })

  it("keeps a key when the reader switches Provider, and drops it when they say to", () => {
    // Switching away must not destroy a credential — trying the on-device model
    // for an afternoon should not cost the reader their API key.
    const elsewhere = withProviderConnection(connected, "on-device")
    expect(isSet(elsewhere.provider.byok.apiKey)).toBe(true)

    // Removing it is its own act, and it also stops the Provider being chosen,
    // so the panel cannot report "not connected" about a Provider the settings
    // page still shows as selected.
    const gone = withoutProviderKey(connected, "byok")
    expect(isSet(gone.provider.byok.apiKey)).toBe(false)
    expect(gone.provider.connection).toBe("none")
  })

  it("does not clear the connection when the credential removed is not the one in use", () => {
    const withBoth = withCodex(connected, { token: "codex-token" })
    const gone = withoutProviderKey(withBoth, "codex")
    expect(gone.provider.connection).toBe("byok")
    expect(isSet(gone.provider.byok.apiKey)).toBe(true)
  })

  it("reads a document from a build that had never heard of Providers", () => {
    // The forward-compatibility rule the whole document is written to: an older
    // document keeps every field it does carry and gains the defaults for the
    // rest. Losing a reader's exclusions to add a Provider field would be a
    // data loss with no error on the one value they were promised control of.
    const older = JSON.stringify({ automatic: false, paused: ["example.com"] })
    const read = fromDocument(older)
    expect(read.paused).toEqual(["example.com"])
    expect(read.provider.connection).toBe("none")
    expect(isSet(read.provider.byok.apiKey)).toBe(false)
  })
})

describe("what counts as connected", () => {
  it("is nothing at all on a fresh install", () => {
    expect(isConnected(firstRun)).toBe(false)
    expect(connectionOf(firstRun)).toBe("none")
    expect(PROVIDER_NAMES[connectionOf(firstRun)]).toBe("no Provider")
  })

  it("is not a Provider chosen with no credential behind it", () => {
    const chosen = withProviderConnection(firstRun, "byok")
    expect(isConnected(chosen)).toBe(false)
    // And it reads back as "nothing connected" rather than as the Provider they
    // picked, because the panel's sentence is about what can actually be asked.
    expect(connectionOf(chosen)).toBe("none")
  })

  it("is a pasted key", () => {
    expect(isConnected(connected)).toBe(true)
    expect(connectionOf(connected)).toBe("byok")
  })

  it("is a pasted Codex token, behind the seam that has no sign-in flow", () => {
    const codex = withProviderConnection(withCodex(firstRun, { token: "t" }), "codex")
    expect(isConnected(codex)).toBe(true)
    expect(PROVIDER_NAMES[connectionOf(codex)]).toBe("ChatGPT")
  })

  it("is the browser's own model without asking for anything", () => {
    // Whether a model is really there is `OnDevice.layer`'s probe, not this
    // function's guess. Selecting it with no model yields `no-model`, which is
    // its own state with its own words.
    expect(isConnected(withProviderConnection(firstRun, "on-device"))).toBe(true)
  })
})

describe("where a key is spent", () => {
  it("goes to OpenAI when the reader named no endpoint", () => {
    expect(baseUrlOf(connected)).toBe(DEFAULT_BASE_URL)
  })

  it("goes wherever the reader said, including a model on their own machine", () => {
    const local = withByok(connected, { baseUrl: "http://localhost:8080/v1/" })
    // The trailing slash is dropped on the way in, so the request path is not
    // built with a double slash against a server that cares.
    expect(baseUrlOf(local)).toBe("http://localhost:8080/v1")
  })

  it("falls back to a small current model rather than to an empty model name", () => {
    const unnamed = withProviderConnection(withByok(firstRun, { apiKey: KEY }), "byok")
    // An empty model reaches the wire as `"model": ""`, which every endpoint
    // rejects — and the reader would be told their key was bad.
    expect(providerFor(unnamed)).toBeDefined()
    expect(DEFAULT_BYOK_MODEL).not.toBe("")
  })
})
