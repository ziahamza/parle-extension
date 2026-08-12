/**
 * The seam has one job that a boolean cannot do: every declined Lookup must
 * arrive carrying the reason the reader is owed. So every test here asserts on
 * the REASON, not on the fact of refusal — a test that only checked
 * `isFailure` would pass just as happily against a policy that withheld
 * everything for the wrong cause and rendered the wrong copy.
 *
 * The X cases are the ones with teeth. ADR 0001 buys the right to query X with
 * the reader's own session by promising a disclosure argument: the address is
 * already demonstrably public. Only a Linked Mention establishes that, and no
 * amount of reader enthusiasm substitutes for it.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { Coverage, type Consultation } from "@parle/domain/Coverage"
import { Mention } from "@parle/domain/Mention"
import { DiscussionId, NativeId } from "@parle/domain/Network"
import { SubjectUrl } from "@parle/domain/Subject"
import { mayAskX } from "@parle/domain/Gate"
import { Controls } from "./Controls.ts"
import { noSignals, type PageSignals } from "./Exclusion.ts"
import { ExclusionList } from "./ExclusionList.ts"
import { type Ask, asConsultation, LookupPolicy, type Reading, type Withholding } from "./LookupPolicy.ts"
import { type Choices, noChoices, ReaderChoices } from "./ReaderChoices.ts"

const subject = SubjectUrl.make("https://example.com/posts/hello")

const reading = (url: SubjectUrl = subject, signals: PageSignals = noSignals): Reading => ({
  subject: url,
  signals
})

const hnLinked: Ask = { network: "hackernews", initiative: "automatic" }
const xLinked: Ask = { network: "x", initiative: "automatic" }

const hnPlace = { _tag: "Network", network: "hackernews" } as const

/** Coverage in which Hacker News found a Discussion that submitted this address. */
const withLinkedMention = Coverage.make({
  subject,
  consultations: [
    {
      _tag: "Answered",
      place: hnPlace,
      mentions: [
        Mention.cases.Linked.make({
          subject,
          discussion: DiscussionId.make({
            network: "hackernews",
            nativeId: NativeId.make("41293011")
          }),
          viaAlias: subject
        })
      ]
    }
  ]
})

/** Coverage in which only a title search matched. Not enough for X. */
const withPassingMention = Coverage.make({
  subject,
  consultations: [
    {
      _tag: "Answered",
      place: { _tag: "Network", network: "hackernews" },
      mentions: [
        Mention.cases.Passing.make({
          subject,
          discussion: DiscussionId.make({
            network: "hackernews",
            nativeId: NativeId.make("41293011")
          }),
          inComment: "Hello"
        })
      ]
    }
  ]
})

const noConsultations: ReadonlyArray<Consultation> = []
const emptyCoverage = Coverage.make({ subject, consultations: noConsultations })

const layerWith = (controls = Controls.layer, choices: Choices = noChoices) =>
  LookupPolicy.layer.pipe(
    Layer.provide(Layer.mergeAll(controls, ExclusionList.layer)),
    Layer.provide(ReaderChoices.inMemory(choices))
  )

const decide = (
  ask: Ask,
  read: Reading = reading(),
  coverage: Coverage = emptyCoverage,
  controls = Controls.layer,
  choices: Choices = noChoices
) =>
  Effect.runSync(
    Effect.gen(function*() {
      const policy = yield* LookupPolicy
      return yield* policy.permits(ask, read, coverage)
    }).pipe(Effect.provide(layerWith(controls, choices)))
  )

const reasonOf = (out: Result.Result<unknown, Withholding>): string | undefined =>
  Result.isFailure(out) ? out.failure.reason : undefined

describe("the ordinary case", () => {
  it("permits Hacker News on an ordinary page", () => {
    expect(Result.isSuccess(decide(hnLinked))).toBe(true)
  })

  it("names the Place, so a Permit and a Withholding land in the same slot of Coverage", () => {
    const out = decide(hnLinked)
    expect(Result.isSuccess(out) && out.success.place._tag).toBe("Network")
  })
})

describe("every reason is reachable and distinct", () => {
  it("compiled-out beats everything, including a reader asking directly", () => {
    const out = decide({ ...xLinked, initiative: "reader" }, reading(), withLinkedMention, Controls.withoutX)
    expect(reasonOf(out)).toBe("compiled-out")
  })

  it("kill-switched, read fresh on every decision", () => {
    const killed = Controls.layerOf({ killSwitched: (n) => Effect.succeed(n === "hackernews") })
    expect(reasonOf(decide(hnLinked, reading(), emptyCoverage, killed))).toBe("kill-switched")
    expect(Result.isSuccess(decide({ ...hnLinked, network: "reddit" }, reading(), emptyCoverage, killed))).toBe(true)
  })

  it("excluded, carrying which rule fired", () => {
    const out = decide(hnLinked, reading(SubjectUrl.make("https://secure.chase.com/web/auth")))
    expect(reasonOf(out)).toBe("excluded")
    expect(Result.isFailure(out) && Option.isSome(out.failure.ground) && out.failure.ground.value._tag)
      .toBe("ListedDomain")
  })

  it("site-paused, once the reader pauses that host", () => {
    const paused: Choices = { ...noChoices, paused: ["example.com"] }
    expect(reasonOf(decide(hnLinked, reading(), emptyCoverage, Controls.layer, paused))).toBe("site-paused")
  })

  it("over-budget, and only after the cheaper reasons have been ruled out", () => {
    const broke = Controls.layerOf({ affords: () => Effect.succeed(false) })
    expect(reasonOf(decide(hnLinked, reading(), emptyCoverage, broke))).toBe("over-budget")
    // An excluded page over budget is reported as excluded, because that is the
    // one the reader can do something about.
    const out = decide(hnLinked, reading(SubjectUrl.make("https://proton.me/mail")), emptyCoverage, broke)
    expect(reasonOf(out)).toBe("excluded")
  })

  it("awaiting-linked-mention, which is the X gate", () => {
    expect(reasonOf(decide(xLinked))).toBe("awaiting-linked-mention")
  })
})

describe("the X gate is a data dependency, not a flag", () => {
  it("opens once Hacker News has returned a Linked Mention", () => {
    const out = decide(xLinked, reading(), withLinkedMention)
    expect(Result.isSuccess(out)).toBe(true)
    expect(Result.isSuccess(out) && out.success.justifiedBy).toEqual(["41293011"])
  })

  it("stays shut on a Passing Mention alone", () => {
    // A title match proves the subject matter was discussed. The address we
    // would hand X is still novel, so the disclosure argument is void.
    expect(reasonOf(decide(xLinked, reading(), withPassingMention))).toBe("awaiting-linked-mention")
  })

  it("opens when the reader asks directly, even with no Linked Mention", () => {
    // Decided against the grain of the argument, and worth recording as such:
    // "they asked for it" is a consent argument while the gate's warrant is a
    // disclosure one, so consent does not actually discharge it. ADR 0001 (as
    // amended) accepts that, because the toolbar may never say "not applicable"
    // and a reader who opens the panel has asked a direct question. The gate
    // still governs every automatic Lookup.
    expect(Result.isSuccess(decide({ ...xLinked, initiative: "reader" }))).toBe(true)
  })

  it("does not gate any other Network on it", () => {
    expect(Result.isSuccess(decide({ ...hnLinked, network: "reddit" }))).toBe(true)
  })
})

describe("the toolbar never says not applicable", () => {
  it("a reader-initiated Ask overrides the Exclusion List", () => {
    const excluded = reading(SubjectUrl.make("https://secure.chase.com/web/auth"))
    expect(reasonOf(decide(hnLinked, excluded))).toBe("excluded")
    expect(Result.isSuccess(decide({ ...hnLinked, initiative: "reader" }, excluded))).toBe(true)
  })

  it("a reader-initiated Ask overrides a pause and manual mode", () => {
    const choices: Choices = { ...noChoices, paused: ["example.com"], manualOnly: true }
    expect(Result.isFailure(decide(hnLinked, reading(), emptyCoverage, Controls.layer, choices))).toBe(true)
    expect(
      Result.isSuccess(
        decide({ ...hnLinked, initiative: "reader" }, reading(), emptyCoverage, Controls.layer, choices)
      )
    ).toBe(true)
  })

  it("but never overrides the kill switch", () => {
    const killed = Controls.layerOf({ killSwitched: () => Effect.succeed(true) })
    expect(reasonOf(decide({ ...hnLinked, initiative: "reader" }, reading(), emptyCoverage, killed)))
      .toBe("kill-switched")
  })
})

describe("what the surfaces call", () => {
  it("wouldAutoLookUp answers the pill's question before <head> has parsed", () => {
    const run = (url: string, choices: Choices = noChoices) =>
      Effect.runSync(
        Effect.gen(function*() {
          const policy = yield* LookupPolicy
          return yield* policy.wouldAutoLookUp(SubjectUrl.make(url))
        }).pipe(Effect.provide(layerWith(Controls.layer, choices)))
      )

    expect(Result.isSuccess(run("https://example.com/a"))).toBe(true)
    expect(reasonOf(run("https://coinbase.com/portfolio"))).toBe("excluded")
    expect(reasonOf(run("https://example.com/a", { ...noChoices, manualOnly: true }))).toBeDefined()
  })

  it("pauseSite takes effect on the next decision", () => {
    const out = Effect.runSync(
      Effect.gen(function*() {
        const policy = yield* LookupPolicy
        const before = yield* policy.permits(hnLinked, reading(), emptyCoverage)
        yield* policy.pauseSite(subject)
        const after = yield* policy.permits(hnLinked, reading(), emptyCoverage)
        return { before, after }
      }).pipe(Effect.provide(layerWith()))
    )
    expect(Result.isSuccess(out.before)).toBe(true)
    expect(reasonOf(out.after)).toBe("site-paused")
  })

  it("a pause covers subdomains of the host it was set on", () => {
    const paused: Choices = { ...noChoices, paused: ["example.com"] }
    const out = decide(hnLinked, reading(SubjectUrl.make("https://app.example.com/x")), emptyCoverage, Controls.layer, paused)
    expect(reasonOf(out)).toBe("site-paused")
  })
})

describe("a Withholding is renderable", () => {
  it("becomes a Consultation, so Coverage still accounts for the Place", () => {
    const out = decide(xLinked)
    expect(Result.isFailure(out)).toBe(true)
    if (!Result.isFailure(out)) return
    const consultation = asConsultation(out.failure)
    expect(consultation._tag).toBe("Withholding")
    expect(consultation._tag === "Withholding" && consultation.reason).toBe("awaiting-linked-mention")
    // And it drops straight into a Coverage, which is the whole point: an empty
    // panel always means something specific.
    const coverage = Coverage.make({ subject, consultations: [consultation] })
    expect(coverage.consultations).toHaveLength(1)
  })
})

describe("the X gate and the reader's initiative", () => {
  // Domain and policy disagreed about this for a few hours; these tests exist so
  // they cannot drift apart again silently.
  const noLinkedMention = Coverage.make({
    subject: "https://example.com/a",
    consultations: [
      { _tag: "Silence", place: { _tag: "Network", network: "hackernews" } }
    ]
  })

  it("withholds X on an automatic Ask when nothing Linked was found", () => {
    expect(mayAskX(noLinkedMention, "automatic")._tag).toBe("Failure")
  })

  it("permits X on a reader-initiated Ask with the same Coverage", () => {
    expect(mayAskX(noLinkedMention, "reader-asked")._tag).toBe("Success")
  })
})
