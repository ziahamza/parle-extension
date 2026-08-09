/**
 * Messaging's one real decision is what to do with a note it does not
 * recognise. Every extension the reader has installed can broadcast into
 * `runtime.onMessage`, so "drop it" is a correctness property, not politeness.
 */
import { describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { decoded, Messaging, MessagingFault, type Note } from "./Messaging.ts"
import { makeDouble, TabId, WebExt, type WebExtApi } from "./WebExtApi.ts"

/** The kind of note this extension actually sends. */
const PanelNote = Schema.TaggedUnion({
  Opened: { subject: Schema.String },
  Shown: { subject: Schema.String }
})
type PanelNote = typeof PanelNote.Type

/**
 * Wait for something the test can actually observe, rather than for a duration.
 *
 * A fixed sleep is a guess about how fast the machine is, and it fails on the
 * slow one — which is CI, running eight packages at once, and not the desk this
 * was written on. Bounded so a genuine regression still fails rather than hangs.
 */
const until = (settled: () => boolean) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 200 && !settled(); attempt++) {
      yield* Effect.sleep("5 millis")
    }
  })

const withMessaging = <A, E>(
  platform: WebExtApi,
  work: Effect.Effect<A, E, Messaging>
) =>
  Effect.runPromise(
    Effect.result(
      Effect.provide(work, Messaging.layer.pipe(Layer.provide(WebExt.doubleLayer(platform))))
    )
  )

describe("decoding inbound notes", () => {
  it("keeps ours and drops everything else", async () => {
    const double = makeDouble()

    const out = await withMessaging(
      double,
      Effect.gen(function*() {
        const messaging = yield* Messaging
        const kept: Array<PanelNote> = []
        const collecting = yield* Effect.forkChild(
          Stream.runForEach(decoded(messaging.deliveries, PanelNote), (note: Note<PanelNote>) =>
            Effect.sync(() => {
              kept.push(note.note)
            }))
        )

        // The platform's own word that the subscription exists. Delivering
        // before it does asserts against an empty list, which is a green test
        // on a fast machine and a red one under load.
        yield* Effect.promise(() => double.listened)
        double.deliver({ _tag: "Opened", subject: "https://example.com/a" })
        // Another extension's broadcast, a malformed note of ours, and a
        // primitive. None of these may take the panel's subscription down.
        double.deliver({ _tag: "SomeOtherExtension/ping" })
        double.deliver({ _tag: "Opened" })
        double.deliver("hello")
        double.deliver({ _tag: "Shown", subject: "https://example.com/a" })

        yield* until(() => kept.length === 2)
        yield* Fiber.interrupt(collecting)
        return kept
      })
    )

    expect(Result.getOrThrow(out)).toEqual([
      { _tag: "Opened", subject: "https://example.com/a" },
      { _tag: "Shown", subject: "https://example.com/a" }
    ])
  })
})

describe("sending", () => {
  it("addresses a tab when told to, and the extension otherwise", async () => {
    const double = makeDouble()

    await withMessaging(
      double,
      Effect.gen(function*() {
        const messaging = yield* Messaging
        yield* messaging.tell({ _tag: "Shown", subject: "https://example.com/a" })
        yield* messaging.tell({ _tag: "Opened", subject: "https://example.com/a" }, TabId.make(9))
      })
    )

    expect(double.sent).toEqual([
      { note: { _tag: "Shown", subject: "https://example.com/a" }, to: undefined },
      { note: { _tag: "Opened", subject: "https://example.com/a" }, to: 9 }
    ])
  })

  it("keeps the reply", async () => {
    const double = makeDouble()
    double.answer = () => ({ _tag: "Shown", subject: "https://example.com/a" })

    const out = await withMessaging(
      double,
      Effect.flatMap(Messaging, (messaging) => messaging.ask({ _tag: "Opened" }))
    )

    expect(Result.getOrThrow(out)).toEqual({ _tag: "Shown", subject: "https://example.com/a" })
  })

  it("treats a closed panel as a typed failure, not a defect", async () => {
    // "Could not establish connection" is the ordinary case — the panel is shut
    // or the worker has not woken — so it must be catchable at the call site.
    const double = makeDouble()
    const platform: WebExtApi = {
      ...double,
      messages: {
        ...double.messages,
        send: () => Promise.reject(new Error("Could not establish connection."))
      }
    }

    const out = await withMessaging(
      platform,
      Effect.flatMap(Messaging, (messaging) => messaging.tell({ _tag: "Opened" }, TabId.make(9)))
    )

    expect(Result.isFailure(out)).toBe(true)
    const raised = Option.getOrThrow(Result.getFailure(out))
    expect(raised).toBeInstanceOf(MessagingFault)
    expect(raised.to).toBe(9)
  })
})
