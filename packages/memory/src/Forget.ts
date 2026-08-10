/**
 * The reader's clearing controls, in the shape ADR 0015 requires them to be
 * offerable.
 *
 * Two stores exist because their privacy properties are opposite. Recollection is
 * built by Harvest from Network pages the reader had already loaded — expensive to
 * rebuild, and never a liability. The Lookup Record is a dated record of addresses
 * they *visited*, which ADR 0001's once-per-TTL rule makes mandatory and which is
 * the thing anyone would actually want gone. ADR 0012 promised a single visible
 * clear when there was only one store; ADR 0015 amends that to **one prominent
 * "forget everything", plus a finer control for the Lookup Record alone**, exactly
 * so that a reader worried about the second is not made to pay for the first.
 *
 * This service is that pair, made expressible in one place. Without it the two
 * controls are a convention — every surface that offers "clear my data" has to
 * remember there are two stores, and the one that forgets is not wrong on screen,
 * it is wrong on disk. {@link Forget.everything} is the prominent control;
 * {@link Forget.lookupRecord} is the finer one; {@link Forget.origin} is neither,
 * and exists for the case where the Exclusion List grows to cover a site already
 * harvested.
 *
 * **It does not rotate the install's salt.** Rotating would make every surviving
 * opaque key unrecognisable, which sounds like a bonus and is a bug: the running
 * worker holds the old salt in its layer, so it would keep writing under it while
 * the next worker read under a new one, and ADR 0001's "at most once per long TTL"
 * would quietly degrade to "once per worker lifetime". Nothing is left to conceal
 * after `everything` anyway — the rows are gone.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { FrontDoorMemory } from "./FrontDoorMemory.ts"
import { LookupRecord } from "./LookupRecord.ts"
import { Recollection } from "./Recollection.ts"

export class Forget extends Context.Service<Forget, {
  /**
   * The prominent control: both stores, everything, one action.
   *
   * Clears the Lookup Record first. If the process dies between the two — an MV3
   * worker being killed mid-clear is not exotic — what survives is harvested
   * Mentions, which is the half that was never a privacy liability. The other
   * order gets that exactly backwards.
   */
  readonly everything: Effect.Effect<void>
  /**
   * The finer control: the Lookup Record alone.
   *
   * Recollection survives, which is the point — it is expensive to rebuild and
   * discloses nothing extra, so a reader who wants the record of what they
   * *asked* removed should not have to throw it away.
   */
  readonly lookupRecord: Effect.Effect<void>
  /** One site, across both stores. */
  readonly origin: (origin: string) => Effect.Effect<void>
}>()("parle/memory/Forget") {
  static readonly layer: Layer.Layer<Forget, never, Recollection | LookupRecord | FrontDoorMemory> = Layer
    .effect(Forget)(
      Effect.gen(function*() {
        const recollection = yield* Recollection
        const record = yield* LookupRecord
        const frontDoors = yield* FrontDoorMemory

        const lookupRecord = record.forget({ _tag: "All" })

        const everything = Effect.gen(function*() {
          yield* lookupRecord
          // Second, with the Lookup Record: it is the same kind of thing — a
          // record of a site the reader opened, under a concealed key — and a
          // "forget everything" that left a list of sites behind would be a
          // control that does not do what it says.
          yield* frontDoors.forgetAll
          yield* recollection.forget({ _tag: "All" })
        })

        const origin = Effect.fn("Forget.origin")(function*(origin: string) {
          yield* record.forget({ _tag: "Origin", origin })
          yield* recollection.forget({ _tag: "Origin", origin })
        })

        return Forget.of({ everything, lookupRecord, origin })
      })
    )
}
