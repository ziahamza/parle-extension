import { describe, expect, it } from "vitest"
import { Holding } from "@parle/archive/Holding"
import { SubjectUrl } from "@parle/domain/Subject"
import { preferArchive } from "./Knowledge.ts"

const found = (history: boolean): Holding =>
  Holding.cases.Found.make({
    record: {
      subject: SubjectUrl.make("https://example.com/piece"),
      archivedUrl: "https://web.archive.org/web/2024/https://example.com/piece",
      snapshotAt: Date.UTC(2024, 0, 1),
      snapshotStatus: "200",
      history: history
        ? { firstCaptureAt: Date.UTC(2024, 0, 1), latestCaptureAt: Date.UTC(2024, 5, 1), contentChanges: 30, clipped: false }
        : null
    }
  })

describe("preferArchive", () => {
  it("lets a kept copy replace an interrupted CouldNotAsk", () => {
    const refusal = Holding.cases.CouldNotAsk.make({ reason: "interrupted" })
    expect(preferArchive(refusal, found(true))._tag).toBe("Found")
  })

  it("lets history replace a kept copy that had none", () => {
    const next = preferArchive(found(false), found(true))
    expect(next._tag).toBe("Found")
    if (next._tag === "Found") expect(next.record.history?.contentChanges).toBe(30)
  })

  it("does not replace a kept copy with a refusal", () => {
    const kept = found(true)
    const refusal = Holding.cases.CouldNotAsk.make({ reason: "timed-out" })
    expect(preferArchive(kept, refusal)).toBe(kept)
  })

  it("does not replace a pending kept copy with an interrupted CouldNotAsk", () => {
    const pending = found(false)
    const refusal = Holding.cases.CouldNotAsk.make({ reason: "interrupted" })
    expect(preferArchive(pending, refusal)).toBe(pending)
  })
})
