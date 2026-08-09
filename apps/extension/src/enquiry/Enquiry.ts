/**
 * The work of finding out about one Subject — owned by the Subject, not by any tab.
 *
 * This is the only discovery capability any caller has, and the only place that
 * knows there are waves. Four things it does are decisions:
 *
 * **It is refcounted by Subject, not scoped to a tab.** A pill and a panel on
 * one page share one set of Lookups. A reader who navigates away and back
 * inside the idle window joins the warm entry rather than starting again — and
 * a back button pressed at 900ms therefore does not discard an answer that has
 * already been paid for against the reader's own account. `RcMap` is what
 * gives that: teardown happens when the last surface lets go *and* the idle
 * window has passed, not when a tab closes.
 *
 * **Wave two is merged, not sequenced.** Hacker News and Reddit are asked
 * together, and every Consultation each connector emits folds into Knowledge as
 * it lands — including the `Asking` one, which is what lets a panel opened
 * mid-flight say "still looking" about a specific Place rather than about the
 * page. Wave three — X — is the only ordered edge, and it is ordered for a
 * reason rather than for tidiness: the gate is a function of what wave two
 * found.
 *
 * **Every Lookup goes through `LookupPolicy.permits` first, and a declined one
 * is written into Coverage as a Withholding.** The alternative — skipping the
 * call — produces a Place that sits at `Pending` forever, which the panel
 * renders as "still looking" about something that will never be asked.
 *
 * **There are three initiatives, and two of them require the reader.** The waves
 * run on the reader's *behalf*, automatically, and every rule in `LookupPolicy`
 * applies to them. {@link Enquiry.insist} is the second: the reader deliberately
 * opened the extension on this page, which ADR 0005 says must always produce a
 * Lookup — "the toolbar never says not applicable" — and which therefore
 * overrides the Exclusion List, a per-site pause, manual mode, and ADR 0001's X
 * gate. It does not override a Network the reader switched off or one compiled
 * out of the build; those are not judgements about this page.
 *
 * {@link Enquiry.summarise} is the third, and it is the most expensive thing in
 * the product: it reads the comment BODIES of the Discussions already found and
 * spends the reader's own Provider quota on them. Nothing automatic can reach
 * it. It is not governed by `LookupPolicy` at all, and that is deliberate rather
 * than an omission — the policy decides whether to disclose an address to a
 * Network on the reader's behalf, and this is the reader disclosing, knowingly,
 * to a Provider they chose and can see named on the button.
 *
 * Insisting re-asks **only the Places currently sitting at a Withholding**. Any
 * other rule would double the disclosure on the ordinary case — a reader opening
 * the panel on a page whose Lookups already answered — which is precisely the
 * thing the whole design spends its effort avoiding.
 *
 * **Row data arrives out of band and is joined here.** A connector's contract
 * is `Stream<Consultation, never, never>`, and a Consultation carries Mentions,
 * which carry identity and evidence and nothing a row can be drawn from. The
 * titles and numbers come through the two sinks into `Gathered`, and this is
 * the one place they are married back up — before the Knowledge is published,
 * so no surface ever sees a Mention it cannot draw.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RcMap from "effect/RcMap"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { Consultation, Place, type Question } from "@parle/domain/Coverage"
import type { LinkedMention } from "@parle/domain/Mention"
import { discussionKey, type Network } from "@parle/domain/Network"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import { Recollection } from "@parle/memory/Recollection"
import type { DiscussionSourceShape } from "@parle/networks/Source"
import { HackerNews } from "@parle/networks/HackerNews"
import { Reddit } from "@parle/networks/Reddit"
import { X } from "@parle/networks/X"
import { Controls } from "@parle/policy/Controls"
import { noSignals } from "@parle/policy/Exclusion"
import { asConsultation, LookupPolicy } from "@parle/policy/LookupPolicy"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { Digesting, wouldRead } from "../ai/Digesting.ts"
import { Gathered, noRows } from "../gathered/Gathered.ts"
import {
  begin,
  DigestStanding,
  fold,
  type Knowledge,
  mark,
  unasked,
  writing
} from "./Knowledge.ts"

/**
 * How long a Subject's Knowledge outlives the last surface watching it.
 *
 * Long enough that a back button, a tab switch, and a panel closed and
 * reopened all rejoin the same Enquiry; short enough that the numbers a reader
 * comes back to are not stale in a way they would notice. It is also, today,
 * the whole of our deduplication: nothing is written to disk that would let a
 * second worker lifetime know this Subject has already been asked about.
 */
const IDLE_WINDOW = "2 minutes"

const RECALL = Place.cases.Recall.make({})

/**
 * Whose idea a Lookup was.
 *
 * The same two words `LookupPolicy.Ask` uses, restated as a name because it is
 * threaded through four functions here and an inline union at each of them is
 * four places to get it wrong.
 */
type Initiative = "automatic" | "reader"

/**
 * Every Linked Mention this Enquiry has accumulated, at that tier and no other.
 *
 * Linked only, and the filter is the whole point. A Topical Mention proves the
 * subject matter was discussed somewhere; it never proves the conversation is
 * about this page. Summarising one into a Digest of this Subject would attribute
 * a stranger's argument to the page the reader is on — which is the same
 * conflation ADR 0001's gate exists to prevent and `panelOf` keeps out of the
 * rows. `@parle/digest`'s `brief` takes `ReadonlyArray<LinkedMention>` by
 * signature, so the compiler holds the other half of it.
 */
const linkedIn = (knowledge: Knowledge): ReadonlyArray<LinkedMention> => {
  const found: Array<LinkedMention> = []
  const seen = new Set<string>()
  for (const consultation of knowledge.coverage.consultations) {
    if (consultation._tag !== "Answered") continue
    for (const mention of consultation.mentions) {
      if (mention._tag !== "Linked") continue
      const key = discussionKey(mention.discussion)
      if (seen.has(key)) continue
      seen.add(key)
      found.push(mention)
    }
  }
  return found
}

/** Whether one Network's Question is currently sitting at a Withholding. */
const withheldAt = (
  knowledge: Knowledge,
  network: Network,
  question: Question
): boolean => {
  const standing = knowledge.coverage.consultations.find((consultation) =>
    consultation.place._tag === "Network" &&
    consultation.place.network === network &&
    consultation.place.question === question
  )
  return standing !== undefined && standing._tag === "Withholding"
}

export class Enquiry extends Context.Service<Enquiry, {
  /**
   * Every Place this Enquiry will account for, known before anything is asked.
   *
   * Exposed so a surface can be seeded with a complete Coverage on its very
   * first frame. Without it there is a window — short, but the one a fast
   * panel renders in — where Coverage is empty and "nothing found" and "not
   * asked yet" are indistinguishable.
   */
  readonly places: ReadonlyArray<Place>
  /**
   * Watch what is known about a Subject.
   *
   * Scoped: releasing the scope is how a surface says it has stopped watching,
   * and the Enquiry ends only when every surface has and the idle window has
   * passed.
   */
  readonly about: (
    subject: SubjectUrl,
    title: string
  ) => Effect.Effect<SubscriptionRef.SubscriptionRef<Knowledge>, never, Scope.Scope>
  /**
   * The reader asked, directly.
   *
   * Re-runs every Place that is currently a Withholding, on the reader's own
   * initiative, and leaves every Place that already answered alone. Scoped for
   * the same reason `about` is: holding the Enquiry is what stops `RcMap`
   * tearing it down under the Lookups this just started.
   */
  readonly insist: (
    subject: SubjectUrl,
    title: string
  ) => Effect.Effect<void, never, Scope.Scope>
  /**
   * The reader asked for a Digest of this Subject's Discussions.
   *
   * A third initiative, and it has to be one: writing a Digest means reading
   * the comment BODIES of several Discussions, which is more traffic than every
   * Lookup on the page put together, and it spends the reader's own Provider
   * quota. Neither is something to do because a page loaded. The panel says
   * what it is about to do and this runs only after they agree.
   *
   * Scoped like the other two, and for the same reason: `RcMap` tears an
   * Enquiry down once the last holder lets go, and the read must not outlive
   * the entry it is writing into.
   */
  readonly summarise: (
    subject: SubjectUrl
  ) => Effect.Effect<void, never, Scope.Scope>
}>()("parle/enquiry/Enquiry") {
  static readonly layer = Layer.effect(
    Enquiry,
    Effect.gen(function*() {
      const identity = yield* SubjectIdentity
      const policy = yield* LookupPolicy
      // Wave one does not go through `LookupPolicy` — it asks nobody, so there
      // is no disclosure to decide about — but ONE of policy's inputs still
      // applies to it. See {@link recall}.
      const controls = yield* Controls
      const recollection = yield* Recollection
      const gathered = yield* Gathered
      const hackerNews = yield* HackerNews
      const reddit = yield* Reddit
      const x = yield* X
      const digesting = yield* Digesting

      const places = [RECALL, ...hackerNews.places, ...reddit.places, ...x.places]

      /**
       * The page title, which belongs to the Reading rather than the Subject.
       *
       * `RcMap` keys on the Subject alone — correctly, because two tabs on one
       * page must share one Enquiry — so the title reaches the lookup out of
       * band. It is only ever read once, when the Enquiry is first opened.
       */
      const titles = new Map<string, string>()

      /**
       * Say again how much a Digest would have to read, now that more is known.
       *
       * Only ever from an {@link unasked} state. A late Lookup landing after the
       * reader has asked must not take a Digest that is being written — or one
       * that has been — off the screen, so the three states that are
       * consequences of the reader's own act are never overwritten by one that
       * is merely a consequence of an answer arriving.
       */
      const restate = (
        ref: SubscriptionRef.SubscriptionRef<Knowledge>
      ): Effect.Effect<void> =>
        SubscriptionRef.update(ref, (held) =>
          unasked(held.digest)
            ? {
              ...held,
              digest: DigestStanding.cases.Ready.make({ discussions: wouldRead(linkedIn(held)) })
            }
            : held)

      /**
       * Publish one Consultation, with whatever rows its Mentions can be drawn as.
       *
       * The join happens before the update rather than in the panel because the
       * sinks have already run by the time a terminal Consultation is emitted —
       * the connectors deposit rows and then answer — so this is the first
       * moment both halves exist, and the last moment before a surface sees it.
       */
      const publish = Effect.fn("Enquiry.publish")(function*(
        ref: SubscriptionRef.SubscriptionRef<Knowledge>,
        consultation: Consultation
      ) {
        if (consultation._tag !== "Answered") {
          yield* SubscriptionRef.update(ref, (k) => fold(k, consultation, noRows))
          return
        }
        const rows = yield* gathered.rowsFor(consultation.mentions)
        yield* SubscriptionRef.update(ref, (k) => fold(k, consultation, rows))
        // What a Digest could be written from just changed, and the offer the
        // panel makes names a number of Discussions.
        yield* restate(ref)
        // Total, and deliberately after the update: remembering is a bonus, and
        // a store that will not take it must not delay what is on screen.
        yield* recollection.remember(consultation.mentions)
      })

      /**
       * Ask one Network one Question, unless policy says not to.
       *
       * `permits` takes the Coverage accumulated so far, which is what makes
       * ADR 0001's gate a data dependency rather than a convention: there is no
       * way to reach X without having produced the evidence that justifies it.
       */
      const consult = Effect.fn("Enquiry.consult")(function*(
        network: Network,
        question: Question,
        subject: SubjectUrl,
        ref: SubscriptionRef.SubscriptionRef<Knowledge>,
        lookup: () => Stream.Stream<Consultation, never, never>,
        initiative: Initiative
      ) {
        const knowledge = yield* SubscriptionRef.get(ref)
        // Insisting re-opens the Places we CHOSE not to ask, and only those. A
        // Place that answered, refused or is mid-flight is left exactly as it
        // is: re-asking it would double the disclosure on the ordinary case of
        // a reader opening the panel on a page whose Lookups already ran.
        if (initiative === "reader" && !withheldAt(knowledge, network, question)) return
        const permitted = yield* policy.permits(
          { network, question, initiative },
          // `noSignals`: nothing in this build parses the page's `<head>`, so
          // the `noindex` layer of the Exclusion List cannot fire. Stated here
          // rather than left to be inferred from an empty array.
          { subject, signals: noSignals },
          knowledge.coverage
        )
        if (Result.isFailure(permitted)) {
          yield* SubscriptionRef.update(ref, (k) => mark(k, asConsultation(permitted.failure)))
          return
        }
        yield* Stream.runForEach(lookup(), (consultation) => publish(ref, consultation))
      })

      /**
       * Wave one: the reader's own machine. Discloses nothing, costs nothing.
       *
       * It still honours the per-Network switches, and that is not a
       * belt-and-braces check — it is the only thing keeping the panel
       * self-consistent. `LookupPolicy` withholds every Reddit Place for a
       * reader who switched Reddit off, so the account says "you switched
       * Reddit off"; before this filter the reader's own cache went on handing
       * up Reddit rows to sit above that sentence. ADR 0014 requires a Network
       * switched off to STAY off, and "off" that still shows me Reddit threads
       * is a switch that reads as broken.
       *
       * `switchedOffByReader` only — never `compiledOut` or `killSwitched`.
       * Those two are facts about US and about asking a Network; a Discussion
       * already on the reader's disk was never asked for, and dropping it would
       * throw away exactly the X coverage ADR 0012 says to obtain without a
       * search request.
       */
      const recall = Effect.fn("Enquiry.recall")(function*(
        subject: SubjectUrl,
        ref: SubscriptionRef.SubscriptionRef<Knowledge>
      ) {
        yield* SubscriptionRef.update(ref, (k) =>
          mark(k, Consultation.cases.Asking.make({ place: RECALL })))
        const held = yield* Stream.runCollect(recollection.recall(subject))
        const mentions: Array<typeof held[number]> = []
        for (const mention of held) {
          if (yield* controls.switchedOffByReader(mention.discussion.network)) continue
          mentions.push(mention)
        }
        yield* publish(
          ref,
          mentions.length === 0
            ? Consultation.cases.Silence.make({ place: RECALL })
            : Consultation.cases.Answered.make({ place: RECALL, mentions })
        )
      })

      const pursue = Effect.fn("Enquiry.pursue")(function*(
        subject: SubjectUrl,
        ref: SubscriptionRef.SubscriptionRef<Knowledge>,
        initiative: Initiative
      ) {
        const aliases: ReadonlyArray<Alias> = yield* identity.aliasesOf(subject)

        // Read when the request is actually built, not when the Enquiry began.
        // `webNavigation.onCommitted` fires before the document has parsed a
        // `<title>`, so the first thing a tab reports is often the PREVIOUS
        // page's title — and the topical Lookup is keyed on it.
        const titleNow = () => titles.get(subject) ?? ""

        const both = (source: DiscussionSourceShape, network: Network) => [
          consult(network, "linked", subject, ref, () => source.linked(subject, aliases), initiative),
          consult(
            network,
            "topical",
            subject,
            ref,
            () => source.topical(subject, titleNow()),
            initiative
          )
        ]

        // Wave one is skipped when the reader insists, and only then. The Recall
        // Place is never withheld — it asks the reader's own machine and
        // discloses nothing — so it has already answered, and re-running it
        // would take a settled Place back to "still looking" for no new fact.
        if (initiative === "automatic") yield* recall(subject, ref)

        // Wave two: the Networks that need no prior evidence. Merged, so the
        // slower of the two cannot hold the faster one behind it.
        yield* Effect.all(
          [...both(hackerNews, "hackernews"), ...both(reddit, "reddit")],
          { concurrency: "unbounded", discard: true }
        )

        // Wave three: X, and only now, because the gate is a function of what
        // wave two found. `permits` reads the accumulated Coverage, so this
        // ordering is enforced by the data the call needs, not by the comment.
        yield* consult("x", "linked", subject, ref, () => x.linked(subject, aliases), initiative)
        yield* consult("x", "topical", subject, ref, () => x.topical(subject, titleNow()), initiative)
      })

      const enquiries = yield* RcMap.make({
        lookup: (subject: string) =>
          Effect.gen(function*() {
            const url = subject as SubjectUrl
            const ref = yield* SubscriptionRef.make(begin(url, places))
            yield* Effect.forkScoped(pursue(url, ref, "automatic"))
            return ref
          }),
        idleTimeToLive: IDLE_WINDOW
      })

      const about = Effect.fn("Enquiry.about")(function*(subject: SubjectUrl, title: string) {
        if (title !== "") titles.set(subject, title)
        return yield* RcMap.get(enquiries, subject)
      })

      const insist = Effect.fn("Enquiry.insist")(function*(subject: SubjectUrl, title: string) {
        if (title !== "") titles.set(subject, title)
        // Held for the duration: `RcMap` tears an Enquiry down once the last
        // holder lets go, and the Lookups this starts must not outlive the
        // entry they are writing into.
        const ref = yield* RcMap.get(enquiries, subject)
        yield* pursue(subject, ref, "reader")
      })

      /**
       * The reader asked for a Digest.
       *
       * Nothing is fetched until this runs. A second ask while one is already
       * being written is dropped rather than queued, so clicking twice cannot
       * cost the reader twice — but an ask after a Digest has been written or
       * refused goes through, because "Try again" and "Write it again" are
       * offers the panel makes and a button that silently does nothing reads as
       * the Provider having failed again.
       */
      const summarise = Effect.fn("Enquiry.summarise")(function*(subject: SubjectUrl) {
        const ref = yield* RcMap.get(enquiries, subject)
        const knowledge = yield* SubscriptionRef.get(ref)
        if (writing(knowledge.digest)) return
        const linked = linkedIn(knowledge)
        // Nothing links to this page, so there is nothing a Digest could be
        // accountable to. Left at `Ready` with a count of zero, which the panel
        // already has words for; inventing a refusal would blame a Provider
        // that was never asked.
        if (linked.length === 0) return
        yield* SubscriptionRef.set(ref, {
          ...knowledge,
          digest: DigestStanding.cases.Writing.make({})
        })
        const said = yield* digesting.write(subject, linked)
        yield* SubscriptionRef.update(ref, (held) => ({ ...held, digest: said }))
      })

      return Enquiry.of({ places, about, insist, summarise })
    })
  )
}
