/**
 * Wikipedia, via the MediaWiki `exturlusage` API. The first reference source.
 *
 * Keyless, anonymous, and CORS-enabled with `origin=*` — so it answers from
 * every context on every platform with no cookie, no account and no host
 * permission argument, which is the same property that made Hacker News the
 * connector everything else degrades around.
 *
 * `exturlusage` is not a search. It is a prefix lookup against MediaWiki's
 * `externallinks` table, which stores each link under a reversed-domain index
 * key **with the protocol as part of that key**. Three consequences shape this
 * file, and all three were measured rather than assumed.
 *
 * ## 1. `euquery` takes the address WITHOUT its scheme; `euprotocol` carries it
 *
 * Passing `euquery=https://example.com/a` matches nothing — not an error, a
 * clean empty answer, which is precisely the shape this project spends its
 * effort refusing to manufacture. The scheme is stripped and handed to
 * `euprotocol` instead. See {@link ./Address.ts}'s `withoutScheme`.
 *
 * ## 2. The two protocols are two different index keys, so one query does NOT
 *    cover both
 *
 * Verified live 2026-08-24. `euprotocol=https&euquery=example.com&eulimit=10`
 * returned ten rows and **every one of them was an `https://` URL** — no
 * `http://` row appeared anywhere in the window, on a domain whose citations
 * on Wikipedia are overwhelmingly `http://`. `euprotocol` defaults to `http`
 * when `euquery` is set, so it is never absent; it is only ever one value.
 *
 * That makes the tempting single query a systematic false negative: a citation
 * written in 2009 as `http://` is invisible to an `https` query, and old
 * citations are most of Wikipedia's citations. Two queries would find both and
 * cost double on every page, including the overwhelming majority of pages
 * Wikipedia has never cited at all.
 *
 * So the budget is spent conditionally: **`https` first, `http` only when the
 * `https` pass yielded nothing we could keep.** One request whenever Wikipedia
 * cites us under `https`, two otherwise, and never more than two.
 *
 * That puts the cost on the UNCITED page, which is most pages, and it is the
 * right way round anyway: the single-query saving would be bought by
 * manufacturing a false "Wikipedia does not cite this page" — and `Uncited` is
 * the one outcome here that gets cached, so the false one would outlive the
 * request that made it. That is the exchange ADR 0005's rule is about.
 *
 * ## 3. `eunamespace=0` is mandatory, and it filters AFTER the limit
 *
 * The same live query without a namespace filter returned ten rows of which
 * **zero were articles**: `Wikipedia:Peer review/…`, `User talk:…/Archive1`,
 * `Talk:OpenID/Archive 1`, `Wikipedia:Reference desk/…`,
 * `Template:Db-g12/testcases`. Talk pages, project pages and template test
 * cases are not trusted references citing a page; showing them as such would
 * be the product lying in the one place it claims not to.
 *
 * The filter is applied by the API, not here — but it is applied to rows the
 * server has already drawn from the window, not before. Verified in the same
 * session: `euprotocol=http&eunamespace=0&euquery=example.com&eulimit=10`
 * returned `exturlusage: []` **together with a `continue` token**. An empty
 * array from this API is therefore NOT evidence that nothing exists. It is
 * evidence that the twenty-five rows we were sent held nothing, which is a
 * fact about the size of our request. `continue` is the API telling us so, and
 * it is carried into the answer as `bounded` — including into the empty
 * branch, which is the branch that gets cached. See {@link Backlink}.
 *
 * ## User-Agent
 *
 * Wikimedia's etiquette policy asks anonymous API clients to identify
 * themselves, and `HttpClient.get` accepts headers, so one is sent. It will
 * often be dropped: `User-Agent` is a forbidden header name for `fetch` in a
 * browser, and every platform transport this extension ships on is `fetch`.
 * Setting it is silently ignored there rather than failing, so the line costs
 * nothing and is honoured wherever the transport is not a browser's. **For the
 * integration wave:** if identification turns out to matter — a 429 rate that
 * anonymous unidentified traffic gets and identified traffic does not — the
 * fix is a `declarativeNetRequest` modifyHeaders rule in the extension for
 * `en.wikipedia.org`, not a change here.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { matchingAddress, withoutScheme } from "./Address.ts"
import { Backlink, type BacklinkAnswer, citedWith } from "./Backlink.ts"
import {
  type BacklinkSourceShape,
  candidateAddresses,
  classify,
  classifyCause
} from "./Source.ts"
import { expectJson, type Unanswered } from "./Wire.ts"

const ENDPOINT = "https://en.wikipedia.org/w/api.php"

/** The one reference work this file speaks for. */
const REFERENCE = "wikipedia" as const

/**
 * The article namespace, and the only one whose citations are references.
 *
 * `0` and not a list. `eunamespace` accepts several, and the temptation is to
 * add `100` (Portal) or `14` (Category); neither cites sources, both would
 * dilute "a trusted reference cites this page" into "this address appears
 * somewhere on Wikipedia".
 */
const ARTICLE_NAMESPACE = "0"

/**
 * How many rows one Lookup will read before it stops.
 *
 * Twenty-five, and the number is a bound rather than a measurement — unlike
 * Hacker News's fifty, there is no 305-page study behind it. It is set where
 * it is because the panel shows a handful of citing pages and because the
 * honest part is REPORTED rather than papered over: a filled window comes back
 * as `bounded`, and `Cited` means "at least these". A caller that wants a
 * total cannot have one, because MediaWiki does not send one.
 */
const WINDOW = "25"

/**
 * Who we are, for Wikimedia's benefit. See the header on why this is often
 * dropped rather than sent.
 */
const USER_AGENT = "Parle/0.1 (browser extension; https://github.com/ziahamza/parle)"

/**
 * One row of `exturlusage`.
 *
 * `title` and `url` are required because a row missing either is not a
 * citation we can show or verify, and a source that quietly skipped such rows
 * would report an `Uncited` built out of rows it could not read. `pageid` and
 * `ns` are advisory — they are not used to decide anything, since the
 * namespace filter is applied by the API — so neither may turn a good answer
 * into a Garble.
 */
const Row = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  pageid: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  ns: Schema.optionalKey(Schema.NullOr(Schema.Number))
})
type Row = typeof Row.Type

/**
 * What MediaWiki answers with.
 *
 * `query.exturlusage` is required, and that is the decision that makes a
 * malformed 200 a Garble rather than an `Uncited`. MediaWiki with
 * `formatversion=2` sends `{"query":{"exturlusage":[]}}` for a genuinely empty
 * answer — verified live 2026-08-24 — so requiring the key costs nothing real
 * and buys the distinction the whole classification exists for. An error
 * envelope, an interstitial, or a future response shape lands as a Garble,
 * which is never cached.
 *
 * `continue` is the API saying there is more behind the window. Its contents
 * are opaque here: we do not paginate, we only report that we could have.
 */
const Answer = Schema.Struct({
  query: Schema.Struct({ exturlusage: Schema.Array(Row) }),
  continue: Schema.optionalKey(Schema.Unknown)
})
type Answer = typeof Answer.Type

const readAnswer = expectJson(Answer)

/**
 * Where a reader goes to read the citing page.
 *
 * Built from the title rather than from `pageid` because a title URL is what a
 * reader recognises and can share. Spaces become underscores — the canonical
 * article path — and the rest is `encodeURI`, not `encodeURIComponent`: the
 * latter escapes `/` and `:`, which are legitimate characters inside an
 * article title and which Wikipedia serves unescaped.
 */
const pageUrl = (title: string): string =>
  `https://en.wikipedia.org/wiki/${encodeURI(title.replace(/ /g, "_"))}`

/**
 * The rows that are really about this Subject, one per citing page.
 *
 * Two things happen here and neither is tidying. Every row is re-checked
 * against the Subject's own Aliases, because `euquery` matches by prefix and a
 * query for `example.com` returns `example.com/openid-return.php` — a
 * different page on the same site (verified live 2026-08-24). And pages are
 * deduped by TITLE, because one article citing a page twice — as a reference
 * and again in an external-links section, or under two Aliases — is one
 * article, and listing it twice reads as two independent references.
 */
const keep = (
  rows: ReadonlyArray<Row>,
  candidates: ReadonlyArray<string>
): ReadonlyArray<Backlink> => {
  const kept = new Map<string, Backlink>()
  for (const row of rows) {
    if (kept.has(row.title)) continue
    const matchedUrl = matchingAddress(row.url, candidates)
    if (matchedUrl === undefined) continue
    kept.set(
      row.title,
      Backlink.make({
        reference: REFERENCE,
        title: row.title,
        url: pageUrl(row.title),
        matchedUrl
      })
    )
  }
  return [...kept.values()]
}

export class Wikipedia extends Context.Service<Wikipedia, BacklinkSourceShape>()(
  "parle/backlinks/Wikipedia"
) {
  static readonly layer = Layer.effect(
    Wikipedia,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        // Transient responses only — 408, 429 and 5xx. 403 is deliberately
        // outside Effect's transient set and must stay there: retrying a
        // refusal spends the reader's own budget to learn the same thing.
        HttpClient.retryTransient({
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          times: 2
        })
      )

      const ask = Effect.fn("Wikipedia.ask")(function*(
        protocol: "https" | "http",
        target: string
      ): Effect.fn.Return<Answer, Unanswered> {
        const response = yield* client.get(ENDPOINT, {
          urlParams: {
            action: "query",
            list: "exturlusage",
            format: "json",
            formatversion: "2",
            // Wikimedia serves the CORS headers only when an origin is named,
            // and `*` is the anonymous form. Without it the request fails in a
            // content script as a transport error, which classifies as
            // `offline` — a Refusal about our side of the wire that is true of
            // every page and looks like a network outage.
            origin: "*",
            eulimit: WINDOW,
            eunamespace: ARTICLE_NAMESPACE,
            euprotocol: protocol,
            euquery: target
          },
          headers: { "user-agent": USER_AGENT }
        })
        return yield* readAnswer(response)
      })

      const answer = Effect.fn("Wikipedia.citing")(function*(
        subject: SubjectUrl,
        aliases: ReadonlyArray<Alias>
      ): Effect.fn.Return<BacklinkAnswer, Unanswered> {
        const candidates = candidateAddresses(subject, aliases)
        // One address is ASKED about and all of them VERIFY. Asking about each
        // Alias would multiply the two-request budget by the number of
        // addresses we happen to hold, which is data we do not control.
        const target = withoutScheme(subject as string)

        const secure = yield* ask("https", target)
        const found = keep(secure.query.exturlusage, candidates)
        // `continue` is carried out of BOTH passes, not only the one that
        // found something. An `https` window that filled and held nothing for
        // us, followed by an empty `http` pass, is a bounded `Uncited` — and
        // an unbounded `Uncited` is the thing that gets cached.
        let bounded = secure.continue !== undefined

        if (found.length > 0) return citedWith(REFERENCE, found, bounded)

        // Nothing we could keep under `https`. The second request is spent
        // here and only here: see the header on why the two protocols are two
        // different index keys.
        const plain = yield* ask("http", target)
        bounded = bounded || plain.continue !== undefined
        return citedWith(REFERENCE, keep(plain.query.exturlusage, candidates), bounded)
      })

      return Wikipedia.of({
        reference: REFERENCE,
        citing: (subject, aliases) =>
          answer(subject, aliases).pipe(
            Effect.catch((trouble) => Effect.succeed(classify(REFERENCE, trouble))),
            // Outside the `catch` rather than inside it, so a defect thrown
            // while BUILDING a request — not only while awaiting one — is
            // still classified. That is the difference between a broken source
            // degrading and a broken source taking the caller's error channel
            // with it.
            Effect.catchCause((cause) => Effect.succeed(classifyCause(REFERENCE, cause)))
          )
      })
    })
  )
}
