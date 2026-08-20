/**
 * Three things about the Exclusion List are worth testing and the rest is
 * enumeration.
 *
 * First, the domains a store reviewer types. The best available upstream list
 * was measured to be missing `proton.me`, `tuta.com`, `icloud.com`,
 * `outlook.office.com`, `coinbase.com`, `monzo.com`, `schwab.com` and
 * `bsky.app` — which is exactly the set that gets typed into a review build.
 *
 * Second, the false positives. A rule that excludes ordinary journalism is a
 * silent, permanent hole in the product on precisely the pages it exists for,
 * and nobody will report it. `max-image-preview:none` is the specific trap: a
 * substring test on the robots directive excludes a large slice of news media
 * on the strength of an image hint.
 *
 * Third, precedence. The reader has to win at both ends, or the residual risk
 * stays "we failed to anticipate your bank" instead of "you told us once".
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { type Exclusion, noSignals, type PageSignals } from "./Exclusion.ts"
import { ExclusionList } from "./ExclusionList.ts"
import { seed } from "./Seed.ts"
import { type Choices, noChoices, ReaderChoices, wholeSite } from "./ReaderChoices.ts"

const ask = (url: string, signals: PageSignals = noSignals, choices: Choices = noChoices): Option.Option<Exclusion> =>
  Effect.runSync(
    Effect.gen(function*() {
      const list = yield* ExclusionList
      return yield* list.excludes(url, signals)
    }).pipe(
      Effect.provide(ExclusionList.layer),
      Effect.provide(ReaderChoices.inMemory(choices))
    )
  )

const tagOf = (url: string, signals?: PageSignals, choices?: Choices): string | undefined => {
  const out = ask(url, signals ?? noSignals, choices ?? noChoices)
  return Option.isSome(out) ? out.value._tag : undefined
}

describe("the domains reviewers actually test", () => {
  it.each([
    "https://proton.me/mail",
    "https://mail.proton.me/u/0/inbox",
    "https://tuta.com/",
    "https://www.icloud.com/mail",
    "https://outlook.office.com/mail/inbox",
    "https://www.coinbase.com/portfolio",
    "https://monzo.com/",
    "https://client.schwab.com/app/accounts",
    "https://bsky.app/profile/someone",
    "https://secure.chase.com/web/auth/dashboard",
    "https://docs.google.com/document/d/abc/edit",
    "https://meet.google.com/abc-defg-hij"
  ])("%s is excluded", (url) => {
    expect(tagOf(url)).toBeDefined()
  })

  it("names the category, so the settings page can say why", () => {
    const out = ask("https://secure.chase.com/web/auth/dashboard")
    expect(Option.isSome(out) && out.value._tag === "ListedDomain" && out.value.category).toBe("banking")
    expect(Option.isSome(out) && out.value._tag === "ListedDomain" && out.value.domain).toBe("chase.com")
  })

  /**
   * A conversation with a model is correspondence, and its address can be a
   * pointer into it — `chatgpt.com/c/<id>` names the reader's own thread. The
   * front page is on the same entry deliberately: measured 2026-08-20, the
   * exact URL `https://chatgpt.com/` had 25 Reddit submissions, nearly all
   * removed or spam, and one of them was what a reader saw drawn on
   * chatgpt.com as its "discussion".
   */
  it("does not ask about a conversation with an AI, nor about the app's front page", () => {
    for (const url of [
      "https://chatgpt.com/",
      "https://chatgpt.com/c/68a4d2e1-1234-8000-b111-2f3a4b5c6d7e",
      "https://chat.openai.com/c/2b1c0d9e-dddd-eeee-ffff-000111222333",
      "https://claude.ai/chat/0e35a3a1-aaaa-bbbb-cccc-666555444333",
      "https://gemini.google.com/app",
      "https://grok.com/"
    ]) {
      const out = ask(url)
      expect(Option.isSome(out) && out.value._tag === "ListedDomain" && out.value.category, url)
        .toBe("ai-chat")
    }
    // The vendor's other estates stay readable — only the chat surface is listed.
    expect(Option.isNone(ask("https://openai.com/index/gpt-5/"))).toBe(true)
    // perplexity.ai stays `search`, deliberately. The exclusion map is
    // last-write-wins by domain, so a second ai-chat row would either be dead
    // or silently reclassify it — the first draft of this change shipped
    // exactly that dead row, and this assertion is what makes the choice a
    // choice rather than an accident of row order.
    const perplexity = ask("https://www.perplexity.ai/")
    expect(
      Option.isSome(perplexity) && perplexity.value._tag === "ListedDomain" &&
        perplexity.value.category
    ).toBe("search")
  })

  /**
   * The check that actually goes red against the state the review caught.
   *
   * Asserting perplexity's category cannot: the map is last-write-wins, so a
   * duplicate row loses silently and the surviving category still answers.
   * What a duplicate IS is a dead entry — one of the two rows does nothing,
   * whichever the author believed — and the settings page lists every row, so
   * the same host would appear under two headings. So the invariant is on the
   * seed itself: one row per domain, no exceptions.
   */
  it("seeds every domain exactly once, so no row is silently dead", () => {
    const domains = seed.entries.map((entry) => entry.domain)
    const twice = domains.filter((domain, at) => domains.indexOf(domain) !== at)
    expect(twice, "duplicate seed rows — the later one wins and the earlier is dead").toEqual([])
  })
})

describe("ordinary reading is not excluded", () => {
  it.each([
    "https://www.theguardian.com/world/2026/aug/08/some-story",
    "https://arstechnica.com/science/2026/08/a-headline-with-words",
    "https://lwn.net/Articles/123456/",
    "https://apnews.com/article/some-long-slug-about-a-thing-2026",
    "https://blog.example.com/2026/08/why-effect",
    "https://en.wikipedia.org/wiki/Effect_system"
  ])("%s is lookupable", (url) => {
    expect(tagOf(url)).toBeUndefined()
  })

  it("excludes the search surface without excluding the vendor's other estates", () => {
    expect(tagOf("https://www.google.com/search?q=parle")).toBe("ListedDomain")
    expect(tagOf("https://blog.google/technology/ai/some-post/")).toBeUndefined()
  })
})

describe("what the page said about itself", () => {
  it.each([
    ["noindex", ["noindex, nofollow"]],
    ["none", ["none"]],
    ["a header alongside a harmless meta", ["max-image-preview:large", "noindex"]],
    ["noindex among other directives", ["max-image-preview:large, noindex, nofollow"]]
  ])("%s excludes", (_name, robots) => {
    expect(tagOf("https://example.com/a", { robots })).toBe("NotIndexed")
  })

  it.each([
    ["nothing at all", []],
    ["an ordinary directive set", ["max-image-preview:large, max-snippet:-1, max-video-preview:-1"]],
    ["an image-preview hint that merely contains the word", ["max-image-preview:none"]],
    ["nofollow alone", ["nofollow"]],
    ["a value that only starts with the letters", ["noneofyourbusiness"]]
  ])("%s does not exclude", (_name, robots) => {
    expect(tagOf("https://example.com/a", { robots })).toBeUndefined()
  })
})

describe("what the address is carrying", () => {
  it.each([
    ["an AWS SigV4 signature", "https://files.example.com/x?X-Amz-Signature=abcdef&X-Amz-Expires=60", "CredentialParameter"],
    ["an Azure SAS signature", "https://acct.blob.core.windows.net/c/b?sig=aB3%2Fx1&sv=2021-08-06", "CredentialParameter"],
    ["a Dropbox share key", "https://www.example.com/s/thing?rlkey=abc123", "CredentialParameter"],
    ["a password", "https://example.com/login?password=hunter2", "CredentialParameter"],
    ["an OAuth authorization-code callback", "https://app.example.com/cb?code=SplxlOB&state=xyz", "AuthorizationCallback"],
    ["a JWT in the path", "https://example.com/v/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc", "JsonWebToken"],
    ["an email address as a value", "https://example.com/unsub?address=someone@example.org", "EmailAddress"],
    ["a bare UUID segment", "https://example.com/doc/123e4567-e89b-12d3-a456-426614174000", "TokenShaped"],
    ["a bare 32-hex segment", "https://example.com/f/9f86d081884c7d659a2feaa0c55ad015", "TokenShaped"]
  ])("%s excludes", (_name, url, tag) => {
    expect(tagOf(url)).toBe(tag)
  })

  it.each([
    // These five bought zero measured recall and caused every marginal false
    // positive. Re-adding one has to be a deliberate act.
    ["a forum thread id", "https://forum.example.com/showthread.php?t=317"],
    ["a US state", "https://shop.example.com/stores?state=CA"],
    ["a bare `s`", "https://example.com/search?s=effect"],
    ["a lowercase slug with digits", "https://apnews.com/article/some-slug-abc123def456789012"],
    ["a lowercase hex-ish slug shorter than 32", "https://example.com/p/9f86d081884c7d65"]
  ])("%s does not exclude", (_name, url) => {
    expect(tagOf(url)).toBeUndefined()
  })
})

describe("the reader wins at both ends", () => {
  it("honours an entry the reader added", () => {
    const choices: Choices = { ...noChoices, excluded: [wholeSite("example.com")] }
    expect(tagOf("https://app.example.com/anything", noSignals, choices)).toBe("ReaderEntry")
  })

  it("honours a path prefix without excluding the whole host", () => {
    const choices: Choices = { ...noChoices, excluded: [{ host: "example.com", pathPrefix: "/admin" }] }
    expect(tagOf("https://example.com/admin/users", noSignals, choices)).toBe("ReaderEntry")
    expect(tagOf("https://example.com/blog/post", noSignals, choices)).toBeUndefined()
  })

  it("lets allow-anyway beat the bundled list", () => {
    const choices: Choices = { ...noChoices, allowedAnyway: [wholeSite("bsky.app")] }
    expect(tagOf("https://bsky.app/profile/someone", noSignals, choices)).toBeUndefined()
  })

  it("lets allow-anyway beat a mechanical rule on an http host", () => {
    const choices: Choices = { ...noChoices, allowedAnyway: [wholeSite("wiki")] }
    expect(tagOf("http://wiki/dashboard", noSignals, choices)).toBeUndefined()
  })

  it("does not let allow-anyway resurrect a non-web scheme", () => {
    // There is no page behind `chrome://settings` to allow, and an override
    // that pretended otherwise would hand a Network an address that means
    // nothing to it.
    const choices: Choices = { ...noChoices, allowedAnyway: [wholeSite("settings")] }
    expect(tagOf("chrome://settings/privacy", noSignals, choices)).toBe("Scheme")
  })
})

describe("the artifact loader", () => {
  it("reports the version in force so support can tell which list ran", () => {
    const version = Effect.runSync(
      Effect.gen(function*() {
        const list = yield* ExclusionList
        return list.artifactVersion
      }).pipe(Effect.provide(ExclusionList.layer), Effect.provide(ReaderChoices.layer))
    )
    expect(version).toBe(0)
  })

  it("folds an update in additively and refuses to let it remove anything", () => {
    const layer = ExclusionList.layerFrom(
      { version: 0, entries: [{ domain: "chase.com", category: "banking" }] },
      { version: 7, entries: [{ domain: "newbank.example", category: "banking" }] }
    ).pipe(Layer.provideMerge(ReaderChoices.layer))

    const run = (url: string) =>
      Effect.runSync(
        Effect.gen(function*() {
          const list = yield* ExclusionList
          return yield* list.excludes(url, noSignals)
        }).pipe(Effect.provide(layer))
      )

    expect(Option.isSome(run("https://newbank.example/accounts"))).toBe(true)
    // The update did not carry `chase.com`; an update may only ever add, so the
    // bundled entry survives and a hostile artifact host cannot widen exposure.
    expect(Option.isSome(run("https://chase.com/login"))).toBe(true)
  })
})
