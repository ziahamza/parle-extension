/**
 * The Watermark decides when a rewrite is worth the reader's own Provider quota.
 * It is internal machinery — nothing here is ever shown to the reader — so the
 * tests are about cost and honesty, not about a feature.
 */
import { describe, expect, it } from "vitest"
import { DiscussionId, NativeId, type Network } from "@parle/domain/Network"
import { isStale, type Numbers, watermarkOf } from "./Watermark.ts"

const on = (network: Network, nativeId: string): DiscussionId =>
  DiscussionId.make({ network, nativeId: NativeId.make(nativeId) })

const hn = on("hackernews", "41293011")
const rd = on("reddit", "1abc2de")

const numbers = (
  discussion: DiscussionId,
  score: number | null,
  comments: number | null
): Numbers => ({ discussion, score, comments })

describe("deciding a Digest is stale", () => {
  const written = watermarkOf([numbers(hn, 400, 100)])

  it("is not stale when nothing moved", () => {
    expect(isStale(written, [numbers(hn, 400, 100)])).toBe(false)
  })

  it("is not stale on a handful of new comments", () => {
    expect(isStale(written, [numbers(hn, 430, 106)])).toBe(false)
  })

  it("is stale when the conversation grew by a quarter", () => {
    expect(isStale(written, [numbers(hn, 430, 126)])).toBe(true)
  })

  it("is stale on twenty new comments even on a huge thread", () => {
    const huge = watermarkOf([numbers(hn, 4_000, 900)])
    expect(isStale(huge, [numbers(hn, 4_000, 921)])).toBe(true)
  })

  it("is stale when a Discussion appears that the Digest never saw", () => {
    // The strongest of the three signals: the Digest was written without that
    // conversation existing, so unchanged numbers elsewhere prove nothing.
    expect(isStale(written, [numbers(hn, 400, 100), numbers(rd, 12, 3)])).toBe(true)
  })

  it("keys on the (Network, native id) pair, not the bare id", () => {
    const collides = watermarkOf([numbers(on("hackernews", "1abc2de"), 400, 100)])
    expect(isStale(collides, [numbers(on("reddit", "1abc2de"), 400, 100)])).toBe(true)
  })

  it("does not rewrite for a score that surged while nothing was said", () => {
    // More people read it. Nobody said anything new. Rewriting would spend the
    // reader's quota to produce the same Findings.
    expect(isStale(written, [numbers(hn, 620, 102)])).toBe(false)
  })

  it("does rewrite when the score moves far enough to be a different reception", () => {
    expect(isStale(written, [numbers(hn, 900, 100)])).toBe(true)
  })

  it("never claims movement from a missing number", () => {
    // A null is not a zero. "The score fell to zero" is a Movement we would have
    // invented out of an absence.
    expect(isStale(written, [numbers(hn, null, null)])).toBe(false)
    const blind = watermarkOf([numbers(hn, null, null)])
    expect(isStale(blind, [numbers(hn, 5_000, 4_000)])).toBe(false)
  })

  it("never treats a Discussion's absence as staleness", () => {
    // Omission from an answer licenses "withdrawn" and nothing stronger, and a
    // partial reading — one Network refusing while another answers — would
    // otherwise trigger a rewrite from less material than we started with.
    expect(isStale(written, [])).toBe(false)
  })

  it("never treats a shrinking number as staleness", () => {
    expect(isStale(written, [numbers(hn, 10, 4)])).toBe(false)
  })

  it("reads a Watermark taken from Observations that omit their numbers", () => {
    // `@parle/memory` spells them `score?: number`; `@parle/networks` spells
    // them `score: number | null`. Both are readable here.
    const optional: Numbers = { discussion: hn }
    expect(isStale(watermarkOf([optional]), [optional])).toBe(false)
  })
})
