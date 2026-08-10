/**
 * The gate on X, and the one Subject-shaped exception to it.
 *
 * ADR 0001's warrant for querying X with the reader's own session is a
 * DISCLOSURE argument: the address is already demonstrably public, so asking
 * reveals nothing new. Only a Linked Mention establishes that — and on a site's
 * front door, an old Linked Mention establishes something weaker. Five
 * submissions of `facebook.com` are five events at a company; none of them makes
 * that address newly public today.
 *
 * The carve-out is deliberately narrow, and the tests below are mostly about how
 * narrow. A fresh Linked Mention on a front door discharges the argument in
 * full, and everything that is not a front door is exactly as it was.
 */
import * as Result from "effect/Result"
import { describe, expect, it } from "vitest"
import { Consultation, Coverage, Place } from "./Coverage.ts"
import { mayAskX, type Standing, unjudged } from "./Gate.ts"
import { Mention } from "./Mention.ts"
import { DiscussionId, discussionKey, NativeId } from "./Network.ts"
import { SubjectUrl } from "./Subject.ts"

const subject = SubjectUrl.make("https://facebook.com/")
const hnLinked = Place.cases.Network.make({ network: "hackernews", question: "linked" })

const idOf = (nativeId: string): DiscussionId =>
  DiscussionId.make({ network: "hackernews", nativeId: NativeId.make(nativeId) })

const linkedTo = (...ids: ReadonlyArray<DiscussionId>): Coverage =>
  Coverage.make({
    subject,
    consultations: [
      Consultation.cases.Answered.make({
        place: hnLinked,
        mentions: ids.map((discussion) => Mention.cases.Linked.make({ subject, discussion, viaAlias: subject }))
      })
    ]
  })

const frontDoor = (fresh: ReadonlyArray<DiscussionId>): Standing => ({
  frontDoor: true,
  fresh: new Set(fresh.map(discussionKey))
})

describe("the gate as it was", () => {
  it("opens on any Linked Mention when nothing is known about the Subject", () => {
    expect(Result.isSuccess(mayAskX(linkedTo(idOf("1"))))).toBe(true)
  })

  it("stays shut with nothing linked, and says which absence it is", () => {
    const shut = mayAskX(Coverage.make({ subject, consultations: [] }))
    expect(Result.isFailure(shut)).toBe(true)
    expect(Result.isFailure(shut) ? shut.failure : null).toBe("awaiting-linked-mention")
  })

  it("opens for a reader who asked, whatever else is true", () => {
    const asked = mayAskX(linkedTo(idOf("1")), "reader-asked", frontDoor([]))
    expect(Result.isSuccess(asked)).toBe(true)
  })
})

describe("on a site's front door", () => {
  it("is not discharged by old Linked Mentions", () => {
    const shut = mayAskX(linkedTo(idOf("1"), idOf("2")), "automatic", frontDoor([]))
    expect(Result.isFailure(shut)).toBe(true)
  })

  it("says front-door rather than 'nothing links here yet'", () => {
    // There ARE Linked Mentions. Telling a reader nothing links to a page with
    // four Hacker News threads linking to it would be false about their own
    // panel, and the account is the one surface that has to be exactly right.
    const shut = mayAskX(linkedTo(idOf("1")), "automatic", frontDoor([]))
    expect(Result.isFailure(shut) ? shut.failure : null).toBe("front-door")
  })

  it("is discharged in full by a fresh one", () => {
    // The same domain restriction the panel's fold uses. If Hacker News was
    // discussing this address this week, the address is public news right now,
    // which is the whole of what the disclosure argument asks for.
    const open = mayAskX(linkedTo(idOf("1"), idOf("2")), "automatic", frontDoor([idOf("2")]))
    expect(Result.isSuccess(open)).toBe(true)
    expect(Result.isSuccess(open) ? open.success.justifiedBy : []).toEqual(["2"])
  })

  it("reports nothing linked when nothing does, front door or not", () => {
    const shut = mayAskX(Coverage.make({ subject, consultations: [] }), "automatic", frontDoor([]))
    expect(Result.isFailure(shut) ? shut.failure : null).toBe("awaiting-linked-mention")
  })
})

describe("an unjudged Subject", () => {
  it("behaves exactly as it did before the carve-out existed", () => {
    // Every caller that does not know gets the prior behaviour. That is what
    // keeps a first visit — where no verdict exists yet — from being punished
    // for the absence of one.
    expect(Result.isSuccess(mayAskX(linkedTo(idOf("1")), "automatic", unjudged))).toBe(true)
    expect(Result.isSuccess(mayAskX(linkedTo(idOf("1")), "automatic"))).toBe(true)
  })
})
