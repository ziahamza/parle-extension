/**
 * The one place harvesting is allowed to spend a request.
 *
 * Deliberately the narrowest seam in this package: one method, one string in,
 * one total answer out. Everything expensive or platform-specific about
 * shortlink resolution is behind it, so {@link ../LinkResolver.ts} — where the
 * caching, the cap and ADR 0012's "never dropped" live — is testable without a
 * network, a clock, or a fake HTTP stack.
 *
 * **Why plain `fetch` and not `HttpClient`.** Both would work in Node; only one
 * works in the browser this ships in. Learning a destination means either
 * reading a `location` header or reading the final URL, and in an extension
 * both are cross-origin: `redirect: "manual"` yields an *opaque redirect*
 * response — status 0, headers unreadable — so the header route silently
 * returns nothing on every real link, while `Response.url` after
 * `redirect: "follow"` is populated and is the value the platform intends for
 * exactly this question. `HttpClientResponse` models `request`, `status`,
 * `headers` and the body; it does not surface the final URL, so it cannot
 * answer the only question this module asks. The `fetch` implementation is
 * injectable rather than reached for directly, which is what keeps that
 * decision testable instead of merely stated.
 *
 * **A `HEAD` first, then one `GET`.** Several shorteners answer `HEAD` with
 * `405` — the request is spent either way, so the fallback buys the answer for
 * the price of a second one and {@link Trail} reports what was actually spent,
 * because the cap upstream is a cap on requests and not on links.
 */
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Loss } from "./Resolution.ts"
import { isBoolean, isFunction, isString } from "@parle/domain/Refine"

/**
 * Where a link led, and what it cost.
 *
 * A plain union rather than a `Schema.TaggedUnion`: this crosses no boundary
 * and is never stored — it is consumed one line after it is produced — so a
 * caller writing `{ _tag: "Lost", why: "Refusal", requests: 1 }` should not have
 * to reach for a constructor.
 *
 * `requests` is on BOTH cases on purpose. A refusal costs exactly as much
 * budget as an answer, and a cap that only counted successes would let a
 * timing-out shortener spend the whole harvest.
 */
export type Trail =
  | {
    readonly _tag: "Landed"
    /** The final address, as the platform reports it. Not canonicalized. */
    readonly url: string
    readonly requests: number
  }
  | {
    readonly _tag: "Lost"
    readonly why: Loss
    readonly requests: number
  }

/** How patient to be with a redirector, and whose `fetch` to use. */
export interface Options {
  /**
   * Nobody is waiting on this.
   *
   * Harvest runs behind the reader rather than in front of them, so the timeout
   * is generous compared with a Lookup's eight seconds — but it is finite,
   * because MV3 kills the worker underneath a pending request and a resolution
   * that never settles holds a slot in a throttled queue forever.
   */
  readonly timeout?: Duration.Input | undefined
  /** Injected so the live path is exercised in tests without a network. */
  readonly fetch?: typeof globalThis.fetch | undefined
}

const defaultTimeout: Duration.Duration = Duration.seconds(10)

/** Nothing asked, nothing spent, and a reason on the record. */
const withheld: Trail = { _tag: "Lost", why: "Withholding", requests: 0 }

/**
 * The two fields this module reads, or `null` if the answer had neither.
 *
 * `follow` is declared total, and `Effect.tryPromise` guards only the call. The
 * reads afterwards are outside that guard, so a `fetch` that answers with
 * something other than a `Response` — a polyfill, a stub, a page script that
 * patched the global, a `Response` subclass with a throwing getter — would
 * raise a defect from a function whose entire contract is that it cannot. That
 * defect travels into the Harvester's forked daemon, which is the one fiber in
 * this package that must never die.
 */
const landingOf = (response: Response): { readonly ok: boolean; readonly url: string } | null => {
  try {
    const ok = response?.ok
    const url = response?.url
    return isBoolean(ok) && isString(url) ? { ok, url } : null
  } catch {
    return null
  }
}

/**
 * Learn where one link goes. Total, and honest about what it spent.
 */
export class Redirects extends Context.Service<Redirects, {
  readonly follow: (url: string) => Effect.Effect<Trail>
}>()("parle/harvest/Redirects") {
  /**
   * Never ask anything.
   *
   * Not a degenerate layer. It is the correct one wherever ADR 0012's request
   * budget is zero — an iOS build under a tight cap, a reader who has paused
   * harvesting — and every link it sees becomes an `Unresolved` Mention keyed
   * on the shortlink rather than a lost one. It is also the safe default: a
   * package that resolved links merely because someone forgot to choose a layer
   * would be a package that made requests by omission.
   */
  static readonly none: Layer.Layer<Redirects> = Layer.succeed(Redirects)(
    Redirects.of({ follow: () => Effect.succeed<Trail>(withheld) })
  )

  /**
   * Follow a fixed table of hops.
   *
   * The table is hop-by-hop rather than shortlink-to-destination so a test can
   * express the chain X actually serves — `t.co` to a publisher's own tracker
   * to the article — and so the loop detection below is exercised by data
   * rather than asserted about.
   */
  static readonly fixed = (hops: Readonly<Record<string, string>>): Layer.Layer<Redirects> =>
    Layer.succeed(Redirects)(
      Redirects.of({
        follow: (url) =>
          Effect.sync<Trail>(() => {
            const seen = new Set<string>([url])
            let current = url
            let requests = 0
            while (requests < 6) {
              const next = hops[current]
              if (next === undefined) {
                return requests === 0
                  // Nothing in the table: the fake was asked about a link it
                  // does not know, which is a Refusal and not a destination.
                  ? { _tag: "Lost", why: "Refusal", requests: 1 }
                  : { _tag: "Landed", url: current, requests }
              }
              requests += 1
              if (seen.has(next)) return { _tag: "Lost", why: "Garble", requests }
              seen.add(next)
              current = next
            }
            return { _tag: "Lost", why: "Garble", requests }
          })
      })
    )

  /**
   * Ask the redirector, letting the platform follow the chain.
   *
   * Every failure is one of the glossary's two: we could not hear an answer
   * (**Refusal** — offline, blocked, timed out, aborted, or a filtered response
   * whose `url` we are not allowed to read), or we heard one that named no
   * destination (**Garble** — a 4xx or 5xx at the end of the chain, a response
   * we cannot read at all, or a chain that went nowhere). Neither is ever
   * raised: a harvest that could fail is a harvest that takes the reader's
   * Recollection down with it.
   *
   * **`Landed` means we learned an address, and nothing weaker.** The address
   * we asked about is never returned as the address we found. It is the single
   * most dangerous value this function could produce, because it is the one
   * that looks like success all the way to the Local Discussion Cache.
   */
  static readonly fetching = (options?: Options): Layer.Layer<Redirects> =>
    Layer.effect(
      Redirects,
      Effect.gen(function*() {
        const timeout = Duration.fromInputUnsafe(options?.timeout ?? defaultTimeout)
        const ask = options?.fetch ?? globalThis.fetch

        // No `fetch` in this world at all — an old Safari extension context, a
        // worker built without it, a test harness. Every call would throw
        // before a byte left the machine, and charging the budget two requests
        // apiece for traffic that never happened would spend ADR 0012's whole
        // hourly cap on nothing. This is restraint, and the reader is owed the
        // reason: a Withholding, at no cost.
        if (!isFunction(ask)) return Redirects.of({ follow: () => Effect.succeed<Trail>(withheld) })

        const attempt = (url: string, method: "HEAD" | "GET") =>
          Effect.tryPromise({
            try: (signal) => ask(url, { method, redirect: "follow", signal }),
            catch: () => "unreachable" as const
          })

        const follow = Effect.fn("Redirects.follow")(function*(url: string) {
          const first = yield* Effect.result(attempt(url, "HEAD"))
          // A `HEAD` a redirector refuses is not the same as a link that does
          // not exist, so the `GET` is worth its request — but only one, and
          // only when the first attempt produced something other than an answer.
          const answered = first._tag === "Success" && (landingOf(first.success)?.ok ?? false)
          const second = answered ? undefined : yield* Effect.result(attempt(url, "GET"))
          const requests = second === undefined ? 1 : 2
          const outcome = second ?? first

          if (outcome._tag === "Failure") {
            return { _tag: "Lost", why: "Refusal", requests } satisfies Trail
          }
          const landing = landingOf(outcome.success)
          // An answer arrived and we could not read it. That is the glossary's
          // Garble exactly, and not a destination.
          if (landing === null || !landing.ok) {
            return { _tag: "Lost", why: "Garble", requests } satisfies Trail
          }
          // `Response.url` is the address AFTER the platform followed the
          // chain, which is the whole reason this module exists — and the ONLY
          // thing that may be returned as a destination.
          //
          // Neither of the two ways it can fail to be one may be reported as a
          // `Landed`. An empty `url` is a filtered response — an opaque
          // cross-origin answer, which in an extension is the normal shape of
          // "you may not read this" — so we could not hear the answer:
          // **Refusal**. A `url` equal to the one we asked about means the
          // platform followed nothing, which for a host we only ask about
          // because it is a shortener is an interstitial served as success:
          // **Garble**.
          //
          // Returning `Landed { url }` for either makes
          // {@link ../LinkResolver.ts} mint a `Resolved` whose subject is the
          // `t.co` address itself, cached for a week and indistinguishable
          // downstream from a destination we actually learned. That is ADR
          // 0012's marquee failure, wearing the tag of its success.
          if (landing.url === "") {
            return { _tag: "Lost", why: "Refusal", requests } satisfies Trail
          }
          if (landing.url === url) {
            return { _tag: "Lost", why: "Garble", requests } satisfies Trail
          }
          return { _tag: "Landed", url: landing.url, requests } satisfies Trail
        }, Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.succeed<Trail>({ _tag: "Lost", why: "Refusal", requests: 1 })
        }), Effect.catchCause(() =>
          // Nothing above is expected to raise. If something does, harvesting
          // still may not: a `follow` that fails is a Harvester daemon that
          // dies and a Local Discussion Cache that silently stops filling.
          Effect.succeed<Trail>({ _tag: "Lost", why: "Refusal", requests: 1 })
        ))

        return Redirects.of({ follow })
      })
    )
}
