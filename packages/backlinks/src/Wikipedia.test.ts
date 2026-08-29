/**
 * The ways this source could look like it works and not.
 *
 * Two of the fixtures below are not invented. The namespace rows and the
 * empty-array-with-a-`continue` were both captured from live MediaWiki on
 * 2026-08-24 (see the header of {@link ./Wikipedia.ts}), and they are the two
 * shapes that would otherwise become a confident lie: talk pages presented as
 * trusted references, and a window that held nothing presented as a world that
 * holds nothing.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Alias, SubjectUrl } from "@parle/domain/Subject"
import type { BacklinkAnswer } from "./Backlink.ts"
import { type Exchange, recording } from "./Recording.ts"
import { Wikipedia } from "./Wikipedia.ts"

const SUBJECT = SubjectUrl.make("https://www.nature.com/articles/d41586-024-02012-5")

const alias = (url: string) => Alias.make({ url, evidence: { _tag: "Redirected", from: url } })

const ok = (body: string): Exchange => ({
  status: 200,
  body,
  headers: { "content-type": "application/json; charset=utf-8" }
})

/** A MediaWiki answer carrying `rows`, and optionally more behind the window. */
const answerOf = (
  rows: ReadonlyArray<{ title: string; url: string; pageid?: number; ns?: number }>,
  more = false
): string =>
  JSON.stringify({
    batchcomplete: true,
    ...(more ? { continue: { eucontinue: "58693015", continue: "-||" } } : {}),
    query: { exturlusage: rows }
  })

interface Run {
  readonly answer: BacklinkAnswer
  readonly asked: ReadonlyArray<string>
}

const run = async (reply: (url: string) => Exchange): Promise<Run> => {
  const wire = recording(reply)
  const answer = await Effect.runPromise(
    Effect.gen(function*() {
      const source = yield* Wikipedia
      return yield* source.citing(SUBJECT, [alias("https://nature.com/articles/d41586-024-02012-5.amp")])
    }).pipe(Effect.provide(Wikipedia.layer.pipe(Layer.provide(wire.layer))))
  )
  return { answer, asked: wire.asked }
}

const backlinks = (answer: BacklinkAnswer) => (answer._tag === "Cited" ? answer.backlinks : [])

describe("a citation is only a citation once it is checked", () => {
  it("turns a citing article that matches an Alias into a Backlink carrying the matched URL", async () => {
    const { answer } = await run(() =>
      ok(answerOf([{ title: "Open-source artificial intelligence", url: SUBJECT as string, pageid: 1, ns: 0 }]))
    )

    expect(answer._tag).toBe("Cited")
    const found = backlinks(answer)
    expect(found).toHaveLength(1)
    expect(found[0]?.reference).toBe("wikipedia")
    expect(found[0]?.title).toBe("Open-source artificial intelligence")
    expect(found[0]?.url).toBe("https://en.wikipedia.org/wiki/Open-source_artificial_intelligence")
    // The evidence. A Backlink that could not say WHICH of our addresses it
    // cites is a claim without the thing that makes it checkable.
    expect(found[0]?.matchedUrl).toBe(SUBJECT as string)
  })

  it("records the Alias a citation matched, not the address we asked under", async () => {
    // The query goes out under the Subject URL; Wikipedia's index matched the
    // AMP address we also hold. Reporting the Subject URL here would claim
    // evidence we do not have.
    const amp = "https://nature.com/articles/d41586-024-02012-5.amp"
    const { answer } = await run(() => ok(answerOf([{ title: "Ranking", url: amp, ns: 0 }])))

    expect(backlinks(answer)[0]?.matchedUrl).toBe(amp)
  })

  it("drops a row that cites a DIFFERENT page on the same site", async () => {
    // Live 2026-08-24: `euquery=example.com` is a PREFIX lookup and returned
    // `https://example.com/openid-return.php` among its first ten rows. Kept
    // unverified, that row claims Wikipedia cites the page the reader is on.
    const { answer } = await run(() =>
      ok(answerOf([{ title: "Something else", url: "https://www.nature.com/articles/d41586-999-99999-9", ns: 0 }]))
    )

    expect(answer._tag).toBe("Uncited")
  })

  it("counts one article citing us twice as one reference", async () => {
    // A reference in the body and again under external links is one article.
    // Listed twice it reads as two independent references, which is the only
    // thing a reader is being asked to weigh here.
    const { answer } = await run(() =>
      ok(
        answerOf([
          { title: "Open-source artificial intelligence", url: SUBJECT as string, ns: 0 },
          {
            title: "Open-source artificial intelligence",
            url: "https://nature.com/articles/d41586-024-02012-5.amp",
            ns: 0
          },
          { title: "Large language model", url: SUBJECT as string, ns: 0 }
        ])
      )
    )

    const found = backlinks(answer)
    expect(found.map((b) => b.title)).toEqual([
      "Open-source artificial intelligence",
      "Large language model"
    ])
    // The FIRST matching row wins, so the surviving Backlink's evidence is the
    // Alias the caller ranked highest — `SubjectIdentity` puts the elected
    // address first. Keeping the last row instead would silently re-evidence a
    // citation against whichever address MediaWiki happened to list last.
    expect(found[0]?.matchedUrl).toBe(SUBJECT as string)
  })
})

describe("the two protocols are two different index keys", () => {
  it("asks https first and stops there when https answered", async () => {
    const { answer, asked } = await run(() =>
      ok(answerOf([{ title: "Cited under https", url: SUBJECT as string, ns: 0 }]))
    )

    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain("euprotocol=https")
    // The scheme never travels in `euquery` — MediaWiki matches nothing at all
    // when it does, which arrives as a clean empty answer rather than an error.
    expect(asked[0]).toContain(encodeURIComponent("www.nature.com/articles/d41586-024-02012-5"))
    expect(asked[0]).not.toContain(encodeURIComponent("https://www.nature"))
    expect(answer._tag).toBe("Cited")
  })

  it("spends the second request on http, and finds the citation written in 2009", async () => {
    // The single-query design's systematic false negative: a citation added
    // when the site was http-only is invisible to an https query, and old
    // citations are most of Wikipedia's citations.
    const { answer, asked } = await run((url) =>
      /euprotocol=http(?!s)/.test(url)
        ? ok(answerOf([{ title: "Nature", url: "http://www.nature.com/articles/d41586-024-02012-5", ns: 0 }]))
        : ok(answerOf([]))
    )

    expect(asked).toHaveLength(2)
    expect(asked[0]).toContain("euprotocol=https")
    expect(asked[1]).toMatch(/euprotocol=http(?!s)/)
    expect(answer._tag).toBe("Cited")
    expect(backlinks(answer)[0]?.title).toBe("Nature")
  })

  it("still spends the second request when https returned rows we could not keep", async () => {
    // "https answered" is not the same as "https answered about us". A window
    // full of other pages on the same site is exactly the case where the http
    // citation is the one that exists.
    const { asked } = await run(() =>
      ok(answerOf([{ title: "Elsewhere", url: "https://www.nature.com/articles/d41586-000-00000-0", ns: 0 }]))
    )

    expect(asked).toHaveLength(2)
  })

  it("asks the article namespace, and only that one", async () => {
    // Live 2026-08-24, unfiltered: ten rows, zero articles — `Wikipedia:Peer
    // review/…`, `User talk:…/Archive1`, `Talk:OpenID/Archive 1`,
    // `Template:Db-g12/testcases`. A talk-page archive is not a trusted
    // reference citing this page.
    const { asked } = await run(() => ok(answerOf([])))
    expect(asked[0]).toContain("eunamespace=0")
  })
})

describe("nothing found is never the same as nothing said", () => {
  it("answers Uncited when both protocols came back empty", async () => {
    const { answer } = await run(() => ok(answerOf([])))
    expect(answer._tag).toBe("Uncited")
    // Unbounded, and therefore cacheable. This is the only outcome in the
    // union that is evidence about the world.
    if (answer._tag === "Uncited") expect(answer.bounded).not.toBe(true)
  })

  it("marks an UNCITED whose window filled — the case that would otherwise be cached", async () => {
    // Verified live 2026-08-24: a namespace-filtered query returned
    // `exturlusage: []` together with a `continue` token. The filter is applied
    // to rows already drawn from the window, so an empty array is a fact about
    // the size of our request and not about Wikipedia.
    const { answer } = await run(() => ok(answerOf([], true)))
    expect(answer._tag).toBe("Uncited")
    if (answer._tag === "Uncited") expect(answer.bounded).toBe(true)
  })

  it("carries a bound out of the https pass into an answer the http pass produced", async () => {
    const { answer } = await run((url) =>
      /euprotocol=http(?!s)/.test(url)
        ? ok(answerOf([{ title: "Nature", url: "http://www.nature.com/articles/d41586-024-02012-5", ns: 0 }]))
        : ok(answerOf([{ title: "Elsewhere", url: "https://www.nature.com/other", ns: 0 }], true))
    )

    expect(answer._tag).toBe("Cited")
    // "At least these". The https window filled with rows we discarded, so
    // there may be citations neither pass ever showed us.
    if (answer._tag === "Cited") expect(answer.bounded).toBe(true)
  })

  it("answers Garbled — not Uncited — when a 200 carries an interstitial", async () => {
    const { answer } = await run(() => ({
      status: 200,
      body: "<html><body>Checking your browser…</body></html>",
      headers: { "content-type": "text/html; charset=utf-8" }
    }))
    expect(answer._tag).toBe("Garbled")
  })

  it("answers Garbled when the body is JSON but not an answer we know", async () => {
    // MediaWiki's error envelope is a 200 with an `error` key and no `query`.
    // Decoded loosely it is an empty citation list, which is cacheable and
    // false.
    const { answer } = await run(() => ok(JSON.stringify({ error: { code: "readapidenied" } })))
    expect(answer._tag).toBe("Garbled")
  })

  it("answers CouldNotAsk — never Uncited — on a 403", async () => {
    const { answer } = await run(() => ({
      status: 403,
      body: "",
      headers: { "content-type": "text/plain" }
    }))
    expect(answer._tag).toBe("CouldNotAsk")
    if (answer._tag === "CouldNotAsk") expect(answer.reason).toBe("forbidden")
  })

  it("answers CouldNotAsk on a 429, which anonymous shared-IP traffic gets", async () => {
    const { answer } = await run(() => ({
      status: 429,
      body: "",
      headers: { "content-type": "text/plain" }
    }))
    expect(answer._tag).toBe("CouldNotAsk")
    if (answer._tag === "CouldNotAsk") expect(answer.reason).toBe("rate-limited")
  })

  it("answers CouldNotAsk on a 503", async () => {
    const { answer } = await run(() => ({
      status: 503,
      body: "",
      headers: { "content-type": "text/plain" }
    }))
    expect(answer._tag).toBe("CouldNotAsk")
  })

  it("never lets a bad day reach the caller as a failure", async () => {
    // The `never` error channel is the whole design. If any of the above could
    // fail instead of classify, a caller's own error channel would carry
    // Wikipedia's outage.
    for (const status of [400, 401, 404, 500, 502, 504]) {
      const { answer } = await run(() => ({
        status,
        body: "",
        headers: { "content-type": "text/plain" }
      }))
      expect(["CouldNotAsk", "Garbled"]).toContain(answer._tag)
    }
  })
})

describe("the request budget", () => {
  it("never issues more than two requests for one Lookup", async () => {
    // Two Aliases are supplied. Asking about each would multiply the budget by
    // data we do not control, so one address is ASKED about and all of them
    // VERIFY.
    const { asked } = await run(() => ok(answerOf([])))
    expect(asked.length).toBeLessThanOrEqual(2)
  })
})
