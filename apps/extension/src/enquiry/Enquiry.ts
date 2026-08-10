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
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as RcMap from "effect/RcMap"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { Consultation, Place } from "@parle/domain/Coverage"
import type { LinkedMention } from "@parle/domain/Mention"
import { discussionKey, type Network } from "@parle/domain/Network"
import type { Alias, SubjectUrl } from "@parle/domain/Subject"
import { FrontDoorMemory } from "@parle/memory/FrontDoorMemory"
import { LookupRecord } from "@parle/memory/LookupRecord"
import { Recollection } from "@parle/memory/Recollection"
import { type DiscussionSourceShape, isRealTitle } from "@parle/networks/Source"
import { HackerNews } from "@parle/networks/HackerNews"
import { Reddit } from "@parle/networks/Reddit"
import { X } from "@parle/networks/X"
import type { Standing } from "@parle/domain/Gate"
import { unjudged } from "@parle/domain/Gate"
import { Controls } from "@parle/policy/Controls"
import { noSignals } from "@parle/policy/Exclusion"
import * as FrontDoor from "@parle/policy/FrontDoor"
import { asConsultation, LookupPolicy } from "@parle/policy/LookupPolicy"
import { SubjectIdentity } from "@parle/policy/SubjectIdentity"
import { Comments } from "@parle/digest/Comments"
import { Digesting, wouldRead } from "../ai/Digesting.ts"
import { Gathered, noRows } from "../gathered/Gathered.ts"
import {
  begin,
  DigestStanding,
  fold,
  type Knowledge,
  mark,
  Opened,
  openedWith,
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
 * The first two are `LookupPolicy.Ask`'s own words. The third is this file's:
 * a `retitle` pursue is the correction path for the one Withholding that is a
 * fact about TIMING rather than about the page — `no-title`, the tab title not
 * having arrived when the Topical Lookup wanted it. It re-opens exactly those
 * Places and no other, and `LookupPolicy` sees it as `automatic`, because the
 * reader did nothing: a title parsing late must not override an exclusion, a
 * pause, or manual mode the way an insisting reader may.
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

/**
 * What the Front Door rule makes of this Subject, from everything learned so
 * far.
 *
 * Derived here rather than read from anywhere, and derived again on every wave,
 * because its only inputs — the Linked Discussions' titles and timestamps — are
 * already in the answer. There is no request to save by caching it and no
 * staleness window to get wrong, which is the same property that lets
 * `FrontDoorMemory` be overwritten freely.
 *
 * Linked Mentions only. A Topical Mention is a title search and a Passing one is
 * somebody quoting a link; neither is a submission of this address, so neither is
 * evidence about what kind of page this is.
 *
 * **The elected Subject URL only, and deliberately not the Reading's Aliases.**
 * `panelOf` judges the redirect chain too, because a site's entrance is still an
 * entrance after it has redirected itself onto a deep path. This verdict is a
 * different thing: it is the one that gets written to `FrontDoorMemory` and that
 * may gate a Topical Lookup and X's stale evidence. A redirect chain belongs to
 * one reader's Reading in one tab, while an Enquiry is Subject-keyed and shared
 * by every tab on the page — so feeding it here would let one tab's navigation
 * decide, and persist, what another tab is allowed to ASK. ADR 0005's rule is
 * that a mechanism which silently withholds is worse than one that costs
 * requests, so the wider evidence reaches only the half that folds, which is
 * re-derived on every frame and costs a click to undo.
 */
const frontDoorOf = (subject: SubjectUrl, knowledge: Knowledge): FrontDoor.Verdict => {
  const keys = new Set(linkedIn(knowledge).map((m) => discussionKey(m.discussion)))
  const submissions = knowledge.discussions
    .filter((d) => keys.has(discussionKey(d.id)))
    .map((d) => ({ title: d.title, postedAt: d.postedAt }))
  return FrontDoor.judge([subject as string], submissions)
}

/**
 * The newest Linked Discussion this Enquiry has seen, as an epoch millisecond.
 *
 * Stored beside a judgement so the next answer can tell whether it saw anything
 * this one did not. That is what makes the memory invalidated by evidence rather
 * than by a clock.
 */
const judgedThroughOf = (knowledge: Knowledge): number => {
  const keys = new Set(linkedIn(knowledge).map((m) => discussionKey(m.discussion)))
  let newest = 0
  for (const discussion of knowledge.discussions) {
    if (!keys.has(discussionKey(discussion.id))) continue
    if (discussion.postedAt !== null && discussion.postedAt > newest) newest = discussion.postedAt
  }
  return newest
}

/** What one Network's Question is currently sitting at, if it is known at all. */
const standingAt = (
  knowledge: Knowledge,
  network: Network,
): Consultation | undefined =>
  knowledge.coverage.consultations.find((consultation) =>
    consultation.place._tag === "Network" &&
    consultation.place.network === network
  )

/** Whether one Network is currently sitting at a Withholding. */
const withheldAt = (
  knowledge: Knowledge,
  network: Network
): boolean => standingAt(knowledge, network)?._tag === "Withholding"

/**
 * What an Enquiry offers, as a named interface rather than inline in the class.
 *
 * Named for the reason `Board`'s shape is (see `reading/Board.ts`): written
 * inline, the shape is resolved while TypeScript is still computing the class's
 * own base type, and past a certain size it gives up and reports TS2310
 * "recursively references itself" with no indication of what overflowed.
 * Adding {@link EnquiryShape.retitle} is what tipped this one over.
 */
export interface EnquiryShape {
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
  /**
   * Open, or close again, one Discussion's comments.
   *
   * A toggle on the reader's own button. Opening costs one request to the
   * Network against their IP; closing costs nothing. Never mints an Enquiry —
   * a Discussion can only be opened on a page somebody is looking at.
   */
  readonly readDiscussion: (
    subject: SubjectUrl,
    key: string
  ) => Effect.Effect<void, never, Scope.Scope>
}

export class Enquiry extends Context.Service<Enquiry, EnquiryShape>()("parle/enquiry/Enquiry") {
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
      // The negative memory: which addresses turned out to be a site's front
      // door. It informs what is drawn and which Topical Lookups go out; it can
      // never stop a Linked Lookup, which is what keeps it clear of ADR 0005.
      const frontDoors = yield* FrontDoorMemory
      // The record that we INTENDED to ask, written before the request goes
      // out. MV3 kills this worker without finalizers, so a fiber-local guard
      // dies with the fiber; this is the only memory of an in-flight Lookup
      // the next worker lifetime has, and it is what keeps ten kills in a row
      // from being ten fresh request budgets against the same Subject.
      const record = yield* LookupRecord
      const gathered = yield* Gathered
      const hackerNews = yield* HackerNews
      const reddit = yield* Reddit
      const x = yield* X
      const digesting = yield* Digesting
      const comments = yield* Comments

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
        subject: SubjectUrl,
        ref: SubscriptionRef.SubscriptionRef<Knowledge>,
        lookup: () => Stream.Stream<Consultation, never, never>,
        initiative: Initiative,
        standing: Standing
      ) {
        const knowledge = yield* SubscriptionRef.get(ref)
        // Insisting re-opens the Places we CHOSE not to ask, and only those. A
        // Place that answered, refused or is mid-flight is left exactly as it
        // is: re-asking it would double the disclosure on the ordinary case of
        // a reader opening the panel on a page whose Lookups already ran.
        if (initiative === "reader" && !withheldAt(knowledge, network)) return
        const permitted = yield* policy.permits(
          { network, initiative },
          // `noSignals`: nothing in this build parses the page's `<head>`, so
          // the `noindex` layer of the Exclusion List cannot fire. Stated here
          // rather than left to be inferred from an empty array.
          { subject, signals: noSignals, standing },
          knowledge.coverage
        )
        if (Result.isFailure(permitted)) {
          yield* SubscriptionRef.update(ref, (k) => mark(k, asConsultation(permitted.failure)))
          return
        }
        /**
         * The Lookup Record's gate, and it reads the LEASE alone — never a
         * settled answer. An unexpired intent means this same Lookup is in
         * flight or its asker was killed inside the lease window, so issuing it
         * again spends the same budget twice; a settled answer is deliberately
         * NOT honoured here, because this worker cannot re-render Mentions it
         * never fetched, and a skip on that strength would draw "nobody
         * discussed this page" over a page somebody did — the durable false
         * negative ADR 0005 refuses (the reason `app/Pipeline.ts` left this
         * store unwired for so long).
         *
         * Automatic initiative only. A reader who insists has asked a direct
         * question and is owed a direct answer; their re-ask also settles the
         * record properly, which a skip never can. The Withholding is
         * `over-budget` — the honest reading of "the request allowance for this
         * Subject is already being spent" — and it renders with "Look it up
         * anyway", so the one state this can put a panel in is overridable with
         * a click.
         */
        if (initiative === "automatic" && (yield* record.intended(subject, network))) {
          yield* SubscriptionRef.update(ref, (k) =>
            mark(
              k,
              Consultation.cases.Withholding.make({
                place: permitted.success.place,
                reason: "over-budget"
              })
            ))
          return
        }
        // Written BEFORE the request, which is the store's whole design: a
        // worker killed between here and the settle leaves the intent behind,
        // and that intent is what the next lifetime's gate above reads.
        const lease = yield* record.intend(subject, network)
        yield* Stream.runForEach(lookup(), (consultation) =>
          Effect.gen(function*() {
            yield* publish(ref, consultation)
            // `Asking` is not an outcome, and `settleFrom` would discharge the
            // lease on it — erasing, mid-flight, the very record the gate needs.
            if (consultation._tag !== "Asking" && consultation._tag !== "Pending") {
              yield* record.settleFrom(lease, consultation)
            }
          }))
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

        const both = (source: DiscussionSourceShape, network: Network, standing: Standing) => [
          consult(network, subject, ref, () => source.linked(subject, aliases), initiative, standing)
        ]

        // Wave one is skipped when the reader insists, and only then. The Recall
        // Place is never withheld — it asks the reader's own machine and
        // discloses nothing — so it has already answered, and re-running it
        // would take a settled Place back to "still looking" for no new fact.
        if (initiative === "automatic") yield* recall(subject, ref)

        // What we concluded about this address last time, if anything. It only
        // ever withholds a TOPICAL Lookup — the title search that on a front
        // door returns conversations about the organisation — and it can never
        // stop the Linked Lookup that finds the Discussions the panel is for.
        // `fresh` is empty here on purpose: it is only read by the X gate, which
        // runs in wave three against the live verdict rather than this one.
        const remembered = yield* frontDoors.recall(subject)
        const before: Standing = { frontDoor: Option.isSome(remembered), fresh: new Set() }

        // Wave two: the Networks that need no prior evidence. Merged, so the
        // slower of the two cannot hold the faster one behind it.
        yield* Effect.all(
          [...both(hackerNews, "hackernews", before), ...both(reddit, "reddit", before)],
          { concurrency: "unbounded", discard: true }
        )

        // Now there is real evidence, so the judgement is made again from it and
        // the memory is brought into line — written when it holds, taken back off
        // when it does not. A wrong entry therefore survives exactly one visit,
        // which is the property that makes remembering this safe at all.
        const learned = yield* SubscriptionRef.get(ref)
        const verdict = frontDoorOf(subject, learned)
        const now = yield* Clock.currentTimeMillis
        if (verdict._tag === "FrontDoor") {
          yield* frontDoors.remember(subject, {
            because: verdict.because,
            judgedThrough: judgedThroughOf(learned)
          })
        } else if (Option.isSome(remembered)) {
          yield* frontDoors.forget(subject)
        }

        // The same domain restriction the panel's fold uses, in the one other
        // place a front-door judgement is allowed to act: a FRESH Linked Mention
        // still discharges ADR 0001's disclosure argument in full, and only a
        // stale one on a front door does not. One rule about what a front door's
        // old Discussions may be used for, not two.
        const fresh = new Set(
          learned.discussions
            .filter((d) => d.postedAt !== null && now - d.postedAt <= FrontDoor.HORIZON_MS)
            .map((d) => discussionKey(d.id))
        )
        const after: Standing = verdict._tag === "FrontDoor" ? { frontDoor: true, fresh } : unjudged

        // Wave three: X, and only now, because the gate is a function of what
        // wave two found. `permits` reads the accumulated Coverage, so this
        // ordering is enforced by the data the call needs, not by the comment.
        yield* consult("x", subject, ref, () => x.linked(subject, aliases), initiative, after)
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
        return yield* RcMap.get(enquiries, subject)
      })

      const insist = Effect.fn("Enquiry.insist")(function*(subject: SubjectUrl, title: string) {
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

      /**
       * Open, or close again, one Discussion's comments.
       *
       * A toggle rather than two acts, because the reader's control is one
       * button. Closing is a local forget and costs nothing; opening costs one
       * request to the Network against the reader's own IP (ADR 0014), which is
       * why it happens on their click and never on a page load.
       *
       * `Unreadable` is a state that is KEPT, not a failure that is swallowed.
       * Reddit answering 403 is ADR 0013's ordinary path, and a row that
       * silently springs shut tells the reader their click did nothing.
       */
      const readDiscussion = Effect.fn("Enquiry.readDiscussion")(function*(
        subject: SubjectUrl,
        key: string
      ) {
        // Never mint: a Discussion can only be opened on a page someone is
        // looking at, and the surface that asked is holding the Enquiry.
        if (!(yield* RcMap.has(enquiries, subject))) return
        const ref = yield* RcMap.get(enquiries, subject)
        const knowledge = yield* SubscriptionRef.get(ref)
        const held = new Map(knowledge.opened).get(key)
        if (held !== undefined) {
          yield* SubscriptionRef.update(ref, (k) => ({
            ...k,
            opened: k.opened.filter(([one]) => one !== key)
          }))
          return
        }
        const discussion = knowledge.discussions.find((d) => discussionKey(d.id) === key)
        if (discussion === undefined) return

        yield* SubscriptionRef.update(ref, (k) =>
          openedWith(k, key, Opened.cases.Reading.make({})))
        const read = yield* comments.of(discussion.id)
        yield* SubscriptionRef.update(ref, (k) =>
          openedWith(
            k,
            key,
            Option.isNone(read)
              ? Opened.cases.Unreadable.make({})
              : Opened.cases.Read.make({
                comments: read.value.comments.map((one) => ({
                  author: one.author ?? "someone",
                  text: one.text,
                  postedAt: null
                })),
                // What the Network said it holds beyond what we took. Absent
                // means we cannot say, and a guess would report our own cap as
                // the size of the conversation.
                beyond: Math.max(
                  0,
                  (read.value.commentCount ?? read.value.comments.length) -
                    read.value.comments.length
                )
              })
          ))
      })

      return Enquiry.of({ places, about, insist, summarise, readDiscussion })
    })
  )
}
