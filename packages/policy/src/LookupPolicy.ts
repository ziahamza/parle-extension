/**
 * The one seam that decides whether to ask.
 *
 * Six independent reasons can stop a Lookup — the Exclusion List, a per-site
 * pause, the reader's manual mode, the remote kill switch, the build flag, the
 * budget, and ADR 0001's X gate. Scattering them across the connectors is how a
 * product ends up asking X on a page that was excluded, or honouring a kill
 * switch on one Network and not another. They are all here, in one order, and
 * the connectors have no opinion at all.
 *
 * **It returns a Withholding, never a boolean.** That is the load-bearing
 * decision. A boolean makes an omission indistinguishable from a Network that
 * had nothing to say, and the reader is owed the difference: a Withholding
 * carries a `Place` and a reason, so it lands in Coverage exactly like an
 * answer would and the panel renders "excluded — check anyway?" instead of a
 * blank space. ADR 0005's own objection to gating is that a silent false
 * negative is one nobody can complain about; this type is the answer to it.
 *
 * **Taking `coverage` as a parameter is what makes the X gate structural.**
 * ADR 0001's warrant for querying X with the reader's own session is a
 * DISCLOSURE argument — the address is already demonstrably public, so asking
 * discloses nothing new — and only a Linked Mention establishes that. Passing
 * accumulated Coverage in makes the evidence a data dependency: you cannot
 * obtain a Permit for X without having produced the Coverage that justifies it.
 * The decision itself is delegated to `Gate.mayAskX` in `@parle/domain` and is
 * not reimplemented here, because a second implementation of the product's
 * primary volume control is a second thing that can be wrong.
 */
import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { Consultation, Coverage, Place, type Question, type WithholdingReason } from "@parle/domain/Coverage"
import { mayAskX } from "@parle/domain/Gate"
import type { Network } from "@parle/domain/Network"
import type { SubjectUrl } from "@parle/domain/Subject"
import { Controls } from "./Controls.ts"
import type { Exclusion, PageSignals } from "./Exclusion.ts"
import { noSignals } from "./Exclusion.ts"
import { ExclusionList } from "./ExclusionList.ts"
import { ReaderChoices } from "./ReaderChoices.ts"

/**
 * One question we are considering putting to one Network, and on whose
 * initiative.
 *
 * `initiative` is not decoration. ADR 0005 requires the toolbar action to work
 * on every page — it may never say "not applicable" — so a reader-initiated Ask
 * overrides the Exclusion List, a per-site pause, manual mode, **and ADR 0001's
 * X gate**.
 *
 * That last one was decided against the grain of the argument, and the comment
 * should say so rather than pretend otherwise. "They asked for it" is a consent
 * argument; the gate's warrant is a *disclosure* argument, and the address is no
 * less novel to X because the reader was curious. The judgement (ADR 0001, as
 * amended) is that a reader who deliberately opens the panel has asked a direct
 * question and is owed a direct answer, and that the toolbar never saying "not
 * applicable" outweighs the marginal disclosure. The gate still governs every
 * automatic Lookup, which is the overwhelming majority of them.
 *
 * It does NOT override the kill switch, the build flag, or the budget. Those are
 * emergency and capacity mechanisms rather than judgements about this Subject,
 * and a reader cannot consent their way past an X integration that is switched
 * off or compiled out.
 */
export interface Ask {
  readonly network: Network
  readonly question: Question
  readonly initiative: "automatic" | "reader"
}

/**
 * As much of a Reading as this decision needs.
 *
 * `@parle/domain` does not ship a `Reading` type; the full one — the cause, the
 * arrival, this reader's horizon, what each surface has been shown — belongs to
 * whichever package owns the reader's stance. Policy takes a Reading rather
 * than a bare `SubjectUrl` so that a future rule which reads the arrival or the
 * cause does not change this signature.
 */
export interface Reading {
  readonly subject: SubjectUrl
  /** What the page said about itself. `noSignals` before `<head>` has parsed. */
  readonly signals: PageSignals
}

/** Permission to issue one Lookup, carrying what justified it. */
export interface Permit {
  readonly ask: Ask
  readonly place: Place
  /**
   * For X, the Linked Mentions that discharged ADR 0001's disclosure argument.
   * Empty for every other Network, which needs no such warrant.
   */
  readonly justifiedBy: ReadonlyArray<string>
}

/**
 * A Lookup we deliberately did not issue, inseparable from the reason.
 *
 * Shaped so it drops straight into Coverage — see {@link asConsultation}. The
 * `ground` is the extra detail the settings page needs and the Coverage
 * vocabulary has no room for: WHICH rule of the Exclusion List fired.
 */
export interface Withholding {
  readonly place: Place
  readonly reason: WithholdingReason
  readonly ground: Option.Option<Exclusion>
}

/** Put a Withholding where every other outcome goes. */
export const asConsultation = (withholding: Withholding): Consultation =>
  Consultation.cases.Withholding.make({ place: withholding.place, reason: withholding.reason })

const hostOf = (raw: string): string | undefined => {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** Coverage with nothing in it — what a pre-flight question is answered against. */
const nothingLearnedYet = (subject: SubjectUrl): Coverage =>
  Coverage.make({ subject, consultations: [] })

export class LookupPolicy extends Context.Service<LookupPolicy, {
  /**
   * Whether this Ask may be issued, given everything learned so far.
   *
   * Never fails: a refusal is a value, because it has to be rendered.
   */
  readonly permits: (
    ask: Ask,
    reading: Reading,
    coverage: Coverage
  ) => Effect.Effect<Result.Result<Permit, Withholding>>
  /**
   * Whether we would look this Subject up at all without being asked.
   *
   * The pill's pre-flight question. Answered as "would we ask Hacker News",
   * because ADR 0005 looks up every non-excluded page on Hacker News and Reddit
   * and gates only X — so if Hacker News is withheld, nothing automatic
   * happens. Answered against `noSignals`, since it is asked before `<head>`
   * has parsed; the `noindex` layer therefore cannot fire here and a page can
   * still be withheld a few milliseconds later.
   */
  readonly wouldAutoLookUp: (subject: SubjectUrl) => Effect.Effect<Result.Result<Permit, Withholding>>
  /** Stop asking about this Subject's host until the reader says otherwise. */
  readonly pauseSite: (subject: SubjectUrl) => Effect.Effect<void>
}>()("parle/policy/LookupPolicy") {
  static readonly layer = Layer.effect(
    LookupPolicy,
    Effect.gen(function*() {
      const controls = yield* Controls
      const exclusions = yield* ExclusionList
      const choices = yield* ReaderChoices

      const permits = Effect.fn("LookupPolicy.permits")(
        function*(ask: Ask, reading: Reading, coverage: Coverage) {
          const place = Place.cases.Network.make({ network: ask.network, question: ask.question })
          const withheld = (reason: WithholdingReason, ground = Option.none<Exclusion>()) =>
            Result.fail<Withholding>({ place, reason, ground })

          // The code to ask is not in this binary. Nothing overrides that, and
          // it is checked first so no later branch can imply otherwise.
          if (controls.compiledOut(ask.network)) return withheld("compiled-out")

          // Read fresh, every time. A build-time read would hold the gate open
          // across the whole session the switch exists to close.
          if (yield* controls.switchedOffByReader(ask.network)) return withheld("network-off")
          if (yield* controls.killSwitched(ask.network)) return withheld("kill-switched")

          if (ask.initiative === "automatic") {
            const chosen = yield* choices.current

            // Manual mode. Reported as `kill-switched` because the Coverage
            // vocabulary has one literal for "a switch turned this off" and the
            // reader's switch and ours share it — the panel cannot currently
            // tell the reader which of the two it was. That is a gap in the
            // shared vocabulary, not a decision made here.
            if (chosen.manualOnly) return withheld("manual-only")

            const host = hostOf(reading.subject)
            if (host !== undefined && chosen.paused.some((p) => host === p || host.endsWith(`.${p}`))) {
              return withheld("site-paused")
            }

            const exclusion = yield* exclusions.excludes(reading.subject, reading.signals)
            if (Option.isSome(exclusion)) return withheld("excluded", exclusion)
          }

          // ADR 0001's gate, as amended: it governs automatic Lookups, and a
          // reader-initiated Ask passes it. The impetus is threaded through to
          // the domain rather than decided here, so there is exactly one place
          // that knows what opens the gate.
          let justifiedBy: ReadonlyArray<string> = []
          if (ask.network === "x") {
            const gate = mayAskX(coverage, ask.initiative === "reader" ? "reader-asked" : "automatic")
            if (Result.isFailure(gate)) return withheld(gate.failure)
            justifiedBy = gate.success.justifiedBy
          }

          // Last, so that a reader who is over budget is told that rather than
          // being told something they could have acted on.
          if (!(yield* controls.affords(ask.network, ask.question))) return withheld("over-budget")

          return Result.succeed<Permit>({ ask, place, justifiedBy })
        }
      )

      const wouldAutoLookUp = Effect.fn("LookupPolicy.wouldAutoLookUp")(function*(subject: SubjectUrl) {
        return yield* permits(
          { network: "hackernews", question: "linked", initiative: "automatic" },
          { subject, signals: noSignals },
          nothingLearnedYet(subject)
        )
      })

      const pauseSite = Effect.fn("LookupPolicy.pauseSite")(function*(subject: SubjectUrl) {
        const host = hostOf(subject)
        if (host !== undefined) yield* choices.pauseSite(host)
      })

      return LookupPolicy.of({ permits, wouldAutoLookUp, pauseSite })
    })
  )

  /** Everything this package needs, wired the way the extension wires it. */
  static readonly layerDefault = LookupPolicy.layer.pipe(
    Layer.provide(Controls.layer),
    Layer.provide(ExclusionList.layer),
    Layer.provide(ReaderChoices.layer)
  )
}
