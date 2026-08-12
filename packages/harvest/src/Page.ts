/**
 * What a Network page is, on the way in, and what reading one produces.
 *
 * ADR 0012's first clause is that browsing a Network *is* the crawl: "whenever
 * the reader is on Hacker News, Reddit or X, every outbound link visible on the
 * page — with the thread it came from — is recorded." A {@link NetworkPage} is
 * that page as it left the content script, and a {@link Sighting} is one of
 * those (link, Discussion, numbers) triples.
 *
 * **Markup, not a DOM.** The page arrives as a string. Two reasons, and the
 * second is the one that decides it: the content script and the background are
 * different worlds, and only a string crosses between them; and there is no
 * `DOMParser` in an MV3 service worker, so a background-side parser that wanted
 * a tree could not have one. Passing markup also means every parser in this
 * package is a pure function of a string, which is what makes the fixtures in
 * {@link ./Fixtures.ts} a real test rather than an illustration.
 *
 * **A broken parser must yield nothing, and say so.** Selectors break whenever
 * a Network reskins, and the dangerous failure is not the empty one — it is the
 * parser that still matches something and produces Mentions pointing at the
 * wrong Discussions, which are indistinguishable from real ones once stored. So
 * every parser is anchored on the one structure that carries a Discussion's
 * native id, drops any block it cannot identify, and reports
 * {@link Legibility}: a page whose anchoring structure was absent altogether is
 * `Illegible`, which reaches {@link BreakageSink} and is the signal that a
 * parser needs rewriting. Silence and breakage look identical in the output and
 * must not look identical in the telemetry.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { DiscussionId, Network } from "@parle/domain/Network"

/**
 * One Network page, as the reader's own browser rendered it.
 *
 * A schema rather than an interface because this crosses the content
 * script/background boundary, where everything is `unknown` until it is
 * decoded — and a page that arrives claiming to be from a Network we do not
 * read is exactly the input a parser must never be handed.
 */
export class NetworkPage extends Schema.Opaque<NetworkPage, { readonly _brand: "NetworkPage" }>()(
  Schema.Struct({
    network: Network,
    /** The address of the Network page itself. Relative hrefs resolve against it. */
    url: Schema.String,
    /** The rendered markup. Never stored — read once and discarded. */
    markup: Schema.String
  })
) {}

/**
 * What a Discussion is, as distinct from how it is currently doing.
 *
 * Restated here rather than imported from a connector package for the reason
 * `@parle/memory` restates its own storage interface: these two halves are
 * built and tested apart, and the integrator wires them. The split from the
 * numbers below is the load-bearing part — a title is a stable property that
 * may be overwritten freely, a score is one reading of something that was true
 * at a moment no Network states.
 *
 * `submittedUrl` is the href VERBATIM, tracking parameters and all. It is the
 * evidence a Linked Mention is made of, and canonicalizing it here would
 * destroy the thing being compared.
 */
export class Discussion extends Schema.Opaque<Discussion, { readonly _brand: "HarvestedDiscussion" }>()(
  Schema.Struct({
    id: DiscussionId,
    title: Schema.String,
    submittedUrl: Schema.NullOr(Schema.String),
    /** Epoch milliseconds, where the page carried a machine-readable time. */
    postedAt: Schema.NullOr(Schema.Number),
    author: Schema.NullOr(Schema.String),
    /** Subreddit name without the `r/` prefix, or null. */
    venue: Schema.NullOr(Schema.String)
  })
) {}

/**
 * A Discussion's mutable numbers as the page showed them.
 *
 * Null rather than zero where the page gave none. A zero we invented renders
 * later as "the score fell to zero", which is a Movement nobody observed.
 */
export interface Numbers {
  readonly score: number | null
  readonly comments: number | null
}

/**
 * One outbound link, the Discussion it was seen in, and that Discussion's
 * numbers at the moment we read the page.
 *
 * The tier is decided by the PARSER, from where on the page the link sat, and
 * it is never revised downstream. A link that is the Discussion's own submitted
 * address is a **Linked Mention**; a link sitting inside a comment on a
 * Discussion about something else is a **Passing Mention**. Collapsing the two
 * would be quiet and expensive: the Linked tier is the only one that discharges
 * ADR 0001's disclosure argument, so promoting a comment link opens the X gate
 * on evidence that does not support it, and demoting a submission closes it on
 * evidence that does.
 */
export interface Sighting {
  /** The href exactly as the page carried it, already made absolute. */
  readonly link: string
  readonly discussion: Discussion
  readonly numbers: Numbers
  readonly tier: "Linked" | "Passing"
  /** Which comment the address appeared in, where the markup named one. */
  readonly inComment: string | undefined
}

/**
 * Whether the page had the structure the parser is written against.
 *
 * A plain union: it is produced and consumed in the same breath and never
 * stored, so a caller should be able to match on it without a constructor.
 *
 * `anchors` counts blocks carrying a native id — the thing a parser must find
 * before it may claim anything — and `read` counts those that yielded at least
 * one link. `anchors > 0, read === 0` is a perfectly ordinary Hacker News page
 * of Ask HN posts; `anchors === 0` on a page with markup in it is a Network
 * that reskinned, which is why only the second is `Illegible`.
 */
export type Legibility =
  | { readonly _tag: "Legible"; readonly anchors: number; readonly read: number }
  | { readonly _tag: "Illegible"; readonly expected: string }

/** Everything one page yielded, and whether the parser could still read it. */
export interface PageReading {
  readonly network: Network
  readonly sightings: ReadonlyArray<Sighting>
  readonly legibility: Legibility
}

/** A parser found none of the structure it is written against. */
export interface Breakage {
  readonly network: Network
  /** The page that could not be read. */
  readonly page: string
  /** The structure the parser looked for and did not find. */
  readonly expected: string
}

/**
 * Where a broken parser reports itself.
 *
 * A `Context.Reference` and not a `Context.Service`: its `Identifier` is
 * `never`, so reading it adds nothing to the Harvester's requirement channel,
 * and a test can supply a recording sink without building a layer.
 *
 * It exists because the alternative is that a Network reskin manifests as the
 * Local Discussion Cache quietly filling up more slowly than it used to — a
 * regression with no error, no failed request and no log line, discovered
 * whenever somebody happens to notice the panel is emptier than it was. The
 * default logs, so the signal exists even when nobody wired anything.
 */
export interface BreakageSink {
  readonly broke: (breakage: Breakage) => Effect.Effect<void>
}

const logging: BreakageSink = {
  broke: (breakage) =>
    Effect.logWarning(
      `harvest could not read a ${breakage.network} page: expected ${breakage.expected}`
    ).pipe(Effect.annotateLogs({ page: breakage.page }))
}

export const BreakageSink = Context.Reference<BreakageSink>(
  "parle/harvest/BreakageSink",
  { defaultValue: () => logging }
)

/**
 * Where the Discussions a harvest saw are handed over.
 *
 * The Local Discussion Cache holds Mentions and Observations; it has no room
 * for a title. A connector that reads a title off a page and drops it makes it
 * unrecoverable without asking the Network again, so it leaves by this door and
 * the integrator decides where it lands. Total by construction, for the reason
 * every sink in this system is: a harvest that could fail is a harvest that can
 * take the reader's panel down with it.
 */
export interface DiscussionSink {
  readonly note: (discussions: ReadonlyArray<Discussion>) => Effect.Effect<void>
}

const discard: DiscussionSink = { note: () => Effect.void }

export const DiscussionSink = Context.Reference<DiscussionSink>(
  "parle/harvest/DiscussionSink",
  { defaultValue: () => discard }
)
