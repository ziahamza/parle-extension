/**
 * The shipped ratings artifact, read once, and the two questions asked of it.
 *
 * `@parle/standing` holds no state and loads no files on purpose — its own
 * header says so: "whoever ships the build decides how the JSON gets here". This
 * file is that decision for the extension, and it is three lines of it: import
 * the committed artifact, decode it once at module load, and hand out the
 * answers.
 *
 * **Once, at module load, and not per frame.** `readStanding` walks 2,800
 * publishers through a `Schema` decoder. `panelOf` runs on every frame of every
 * panel, and a Lookup landing redraws the panel, so decoding there would pay for
 * the whole artifact several times per page for an answer that cannot change
 * between releases. The cost is paid when the background worker starts and never
 * again in that worker's life.
 *
 * **Nothing here can issue a request, and that is the whole privacy argument for
 * the feature** (ADR 0022). A rating looked up in a file the reader already has
 * discloses nothing at all: no request, no IP, no timing, no budget to meter,
 * nothing to withhold and no reason owed for withholding it. This module is
 * therefore reachable from the panel derivation without any of the gates the
 * Archive and Wikipedia Lookups pass through, because there is nothing to gate.
 *
 * **`undefined` everywhere means "we have nothing to say".** A malformed
 * artifact yields no Standing rather than a wrong one — `readStanding` refuses
 * unknown values, unknown rater names and an unsupported schema version — and a
 * build that half-understands the file shows a reader something confidently
 * wrong in a third party's name, which is worse than showing nothing.
 */
import raw from "@parle/standing/data/standing.json"
import {
  licenceNotices,
  NONCOMMERCIAL_NOTICE,
  readStanding,
  standingOf
} from "@parle/standing/Artifact"
import type { Standing } from "@parle/standing/Standing"

/**
 * The artifact, or nothing.
 *
 * `readStanding` is total — it returns `undefined` for anything it cannot
 * decode, including a value that throws while being read — so this cannot throw
 * at module load and take a background worker down with it.
 */
const artifact = readStanding(raw)

/** What the named raters say about the publisher of a page on this host. */
export const standingFor = (host: string | null): Standing | undefined =>
  host === null || host === "" || artifact === undefined
    ? undefined
    : standingOf(artifact, host)

/**
 * The attribution the licences require, one line per rater.
 *
 * CC BY 4.0, CC BY-SA 4.0 and CC BY-NC 4.0 each require the source and the
 * licence be named wherever the material is used, and ADR 0022 records rendering
 * these as a **shipping condition** rather than a courtesy: they are the only
 * reason this data may be shipped at all. Empty only when there is no artifact
 * to attribute, which is also the case in which nothing is shown from it.
 */
export const licenceLines = (): ReadonlyArray<string> =>
  artifact === undefined ? [] : licenceNotices(artifact)

/**
 * The one licence term that binds the project rather than the artifact.
 *
 * Re-exported so the settings page imports its credits from one place. AllSides
 * publishes under CC BY-**NC**: while its ratings are aboard, a paid tier, a
 * sponsorship or a commercial fork is a licence breach, and this sentence exists
 * to be read by a human before anyone proposes one.
 */
export { NONCOMMERCIAL_NOTICE }
