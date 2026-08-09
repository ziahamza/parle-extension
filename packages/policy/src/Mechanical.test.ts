/**
 * The mechanical layer is the only layer of the Exclusion List that claims
 * completeness, so a rule that silently does not fire is worse here than
 * anywhere else — it is a gap in the one place the ADR says there is none.
 *
 * The negative cases matter as much as the positive ones. `172.15.0.1` and
 * `100.128.0.1` sit one bit outside their private ranges and are ordinary
 * public addresses; a boundary error in either direction is either a private
 * host disclosed to three Networks, or a whole class of public pages silently
 * unlookupable.
 */
import { describe, expect, it } from "vitest"
import * as Option from "effect/Option"
import { mechanical } from "./Mechanical.ts"

const ruleFor = (raw: string): string | undefined => {
  const out = mechanical(raw)
  return Option.isSome(out) ? out.value._tag : undefined
}

describe("every mechanical rule fires", () => {
  it.each([
    ["chrome://settings/privacy", "Scheme"],
    ["chrome-extension://abcdef/panel.html", "Scheme"],
    ["moz-extension://abcdef/panel.html", "Scheme"],
    ["safari-web-extension://abcdef/panel.html", "Scheme"],
    ["about:blank", "Scheme"],
    ["file:///Users/someone/tax-return.pdf", "Scheme"],
    ["data:text/html,<h1>hi</h1>", "Scheme"],
    ["view-source:https://example.com/", "Scheme"],
    ["not a url at all", "Scheme"]
  ])("%s is not a web address", (raw, tag) => {
    expect(ruleFor(raw)).toBe(tag)
  })

  it.each([
    ["http://0.0.0.0:8080/", "0.0.0.0/8"],
    ["http://127.0.0.1:3000/admin", "127.0.0.0/8"],
    ["http://127.1.2.3/", "127.0.0.0/8"],
    ["http://10.0.0.5/dashboard", "10.0.0.0/8"],
    ["http://172.16.0.1/", "172.16.0.0/12"],
    ["http://172.31.255.254/", "172.16.0.0/12"],
    ["http://192.168.1.1/setup", "192.168.0.0/16"],
    ["http://169.254.1.1/", "169.254.0.0/16"],
    ["http://100.64.0.1/", "100.64.0.0/10"],
    ["http://100.127.255.254/", "100.64.0.0/10"]
  ])("%s is a private IPv4 literal", (raw, range) => {
    const out = mechanical(raw)
    expect(Option.isSome(out) && out.value._tag === "PrivateAddress" && out.value.range).toBe(range)
  })

  it.each([
    ["http://[::1]/", "::1/128"],
    ["http://[fc00::1]/", "fc00::/7"],
    ["http://[fd12:3456:789a::1]/", "fc00::/7"],
    ["http://[fe80::1234]/", "fe80::/10"]
  ])("%s is a private IPv6 literal", (raw, range) => {
    const out = mechanical(raw)
    expect(Option.isSome(out) && out.value._tag === "PrivateAddress" && out.value.range).toBe(range)
  })

  it.each([
    ["http://intranet/", "SingleLabelHost"],
    ["http://wiki/dashboard", "SingleLabelHost"],
    ["http://jira/browse/ENG-1", "SingleLabelHost"],
    ["http://localhost:3000/", "SingleLabelHost"],
    ["https://printer.local/status", "InternalSuffix"],
    ["https://git.internal/repo", "InternalSuffix"],
    ["https://wiki.corp/page", "InternalSuffix"],
    ["https://nas.home.arpa/files", "InternalSuffix"],
    ["https://box.lan/", "InternalSuffix"],
    ["https://thing.test/", "InternalSuffix"],
    ["https://thing.invalid/", "InternalSuffix"],
    ["http://facebookcorewwwi.onion/", "InternalSuffix"],
    ["http://something.i2p/", "InternalSuffix"]
  ])("%s is a non-public name", (raw, tag) => {
    expect(ruleFor(raw)).toBe(tag)
  })

  it("credentials in the authority are excluded even on an ordinary host", () => {
    // The dangerous case is exactly the one where everything else looks normal.
    expect(ruleFor("https://alice:hunter2@example.com/reports")).toBe("UserInfo")
    expect(ruleFor("https://token@example.com/reports")).toBe("UserInfo")
  })
})

describe("public addresses are left alone", () => {
  it.each([
    "https://example.com/article",
    "http://8.8.8.8/",
    // One bit outside the private ranges, in both directions.
    "http://172.15.0.1/",
    "http://172.32.0.1/",
    "http://100.63.255.255/",
    "http://100.128.0.1/",
    "http://11.0.0.1/",
    "http://[2001:4860:4860::8888]/",
    "https://news.ycombinator.com/item?id=1",
    "https://sub.domain.example.co.uk/x"
  ])("%s is a web address", (raw) => {
    expect(ruleFor(raw)).toBeUndefined()
  })

  it("does not mistake a `.testing` suffix for the reserved `.test`", () => {
    expect(ruleFor("https://example.testing.com/")).toBeUndefined()
  })
})
