/**
 * The one assertion in this file that is a design decision rather than a
 * behaviour check is "a listed domain still mints a Subject URL".
 *
 * It is tempting to make `identify` return `None` for everything the Exclusion
 * List covers — one gate, one answer. It is also wrong: a bank's login page is
 * a real public page, so collapsing it to `None` means no Subject URL, so no
 * Place in Coverage, so no Withholding, so no reason, so an empty panel and no
 * "check anyway" affordance and nothing for the reader to override. Only the
 * mechanical layer — where there genuinely is no public page — may answer
 * `None`.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { hrefOf, SubjectUrl } from "@parle/domain/Subject"
import { rulesVersion } from "./Canonical.ts"
import { SubjectIdentity } from "./SubjectIdentity.ts"

const identify = (raw: string): string | undefined =>
  Effect.runSync(
    Effect.gen(function*() {
      const identity = yield* SubjectIdentity
      const out = yield* identity.identify(raw)
      return Option.isSome(out) ? hrefOf(out.value) : undefined
    }).pipe(Effect.provide(SubjectIdentity.layer))
  )

const aliases = (url: string): ReadonlyArray<string> =>
  Effect.runSync(
    Effect.gen(function*() {
      const identity = yield* SubjectIdentity
      const out = yield* identity.aliasesOf(SubjectUrl.make(url))
      return out.map((alias) => alias.url)
    }).pipe(Effect.provide(SubjectIdentity.layer))
  )

describe("minting", () => {
  it("elects one address for the many that reach a page", () => {
    const expected = "https://example.com/posts/hello"
    expect(identify("https://www.example.com/posts/hello/?utm_source=x#top")).toBe(expected)
    expect(identify("https://m.example.com/posts/hello/index.html")).toBe(expected)
  })

  it("carries the rules version that minted it", () => {
    const version = Effect.runSync(
      Effect.gen(function*() {
        const identity = yield* SubjectIdentity
        return identity.rulesVersion
      }).pipe(Effect.provide(SubjectIdentity.layer))
    )
    expect(version).toBe(rulesVersion)
  })
})

describe("what is not a Subject", () => {
  it.each([
    "chrome://settings/privacy",
    "file:///Users/someone/tax-return.pdf",
    "about:blank",
    "http://192.168.1.1/setup",
    "http://[::1]:8080/",
    "http://intranet/wiki",
    "https://printer.local/status",
    "https://alice:hunter2@example.com/reports",
    "not a url"
  ])("%s mints nothing", (raw) => {
    expect(identify(raw)).toBeUndefined()
  })

  it("re-checks after canonicalization moved the address", () => {
    // An AMP proxy unwraps to somebody else's document. If that document turns
    // out to live on a private host, the address we would actually send is the
    // private one — so the rules have to run again on the result, not only on
    // the input.
    expect(identify("https://cdn.ampproject.org/c/s/192.168.1.1/dashboard")).toBeUndefined()
  })
})

describe("an excluded page is still a Subject", () => {
  it.each([
    "https://secure.chase.com/web/auth/dashboard",
    "https://proton.me/mail",
    "https://docs.google.com/document/d/abc/edit"
  ])("%s mints a Subject URL, so the Withholding has somewhere to land", (raw) => {
    expect(identify(raw)).toBeDefined()
  })
})

describe("aliases", () => {
  it("offers the forms a submitter might have pasted", () => {
    const out = aliases("https://example.com/posts/hello")
    expect(out).toContain("https://www.example.com/posts/hello")
    expect(out).toContain("http://example.com/posts/hello")
    expect(out).toContain("https://example.com/posts/hello/")
    expect(out).not.toContain("https://example.com/posts/hello")
  })

  it("puts the form people actually paste within reach of a connector's cap", () => {
    // A connector cannot ask about an unbounded alias set — Hacker News caps at
    // four addresses, in the order given here. `https://www.` is the commonest
    // submitted form by a wide margin, so an order that pushed it behind two
    // `http://` variants would drop the strong tier on every `www.` site, and
    // the only symptom would be Mentions that never appeared.
    const out = aliases("https://example.com/posts/hello")
    const firstFour = out.slice(0, 4)

    expect(firstFour).toContain("https://www.example.com/posts/hello")
    expect(firstFour.indexOf("https://www.example.com/posts/hello"))
      .toBeLessThan(firstFour.indexOf("http://example.com/posts/hello"))
  })

  it("offers every YouTube surface for one video", () => {
    const out = aliases("https://youtube.com/watch?v=dQw4w9WgXcQ")
    expect(out).toContain("https://youtu.be/dQw4w9WgXcQ")
    expect(out).toContain("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    expect(out).toContain("https://m.youtube.com/watch?v=dQw4w9WgXcQ")
  })
})
