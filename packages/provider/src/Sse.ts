/**
 * Server-sent events, decoded so that a stream cut in half keeps its first half.
 *
 * Both HTTP Providers stream `text/event-stream`, and the path is always the
 * same: `HttpClientResponse.stream → Stream.decodeText → Stream.splitLines →
 * events`. Bytes do not arrive on event boundaries and a single event's `data:`
 * may span several lines, so the fold below is the only place that knows where
 * an event ends.
 *
 * THE RULE THAT MATTERS: an event is dispatched only when its terminating blank
 * line arrives. A Provider killed mid-event leaves a half-written `data:` line
 * in the accumulator and it is DROPPED, while every event that completed before
 * it has already been emitted. That is deliberate and it is the opposite of
 * flushing the tail: the tail of a Digest stream is half a JSON object, and
 * emitting it would turn a salvageable partial answer into a Garble that takes
 * the complete Findings down with it.
 *
 * Consequently there is no `onHalt` handler on the fold. Losing the last event
 * of a truncated stream is the price of never inventing one.
 */
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"

/** One dispatched event: its name, and its data lines joined with newlines. */
export interface SseEvent {
  /** The `event:` field, or `"message"` when the sender omitted one. */
  readonly name: string
  /** The accumulated `data:` payload, with the trailing newline removed. */
  readonly data: string
}

/** An event under construction. Empty `data` means nothing to dispatch yet. */
interface Pending {
  readonly name: string
  readonly data: string
}

const fresh: Pending = { name: "", data: "" }

const none: ReadonlyArray<SseEvent> = []

/**
 * Fold one line into the event being built, emitting an event on a blank line.
 *
 * Follows the WHATWG dispatch rules closely enough that the differences are
 * worth naming: `id:` and `retry:` are parsed and discarded (we never resume a
 * stream, so a last-event-id would be a promise we do not keep), and an unknown
 * field is ignored rather than treated as data.
 */
const fold = (pending: Pending, rawLine: string): readonly [Pending, ReadonlyArray<SseEvent>] => {
  // `splitLines` handles CRLF, but a lone CR can still ride in on a mid-chunk
  // boundary from a server that is careless about framing.
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

  if (line === "") {
    // The blank line is the dispatch. An empty data buffer means the sender
    // sent only a comment or an `event:` with nothing under it — not an event.
    return pending.data === ""
      ? [fresh, none]
      : [fresh, [{
        name: pending.name === "" ? "message" : pending.name,
        data: pending.data.slice(0, -1)
      }]]
  }

  // A line beginning with a colon is a comment. Servers send these as keepalives.
  if (line.startsWith(":")) return [pending, none]

  const colon = line.indexOf(":")
  const field = colon === -1 ? line : line.slice(0, colon)
  const raw = colon === -1 ? "" : line.slice(colon + 1)
  const value = raw.startsWith(" ") ? raw.slice(1) : raw

  switch (field) {
    case "event":
      return [{ name: value, data: pending.data }, none]
    case "data":
      return [{ name: pending.name, data: `${pending.data}${value}\n` }, none]
    default:
      return [pending, none]
  }
}

/** Dispatch the events carried by a stream of already-split lines. */
export const events = <E, R>(lines: Stream.Stream<string, E, R>): Stream.Stream<SseEvent, E, R> =>
  lines.pipe(Stream.mapAccum(() => fresh, fold))

/** Dispatch the events carried by a stream of response bytes. */
export const fromBytes = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<SseEvent, E, R> =>
  events(bytes.pipe(Stream.decodeText(), Stream.splitLines))

/**
 * An event's payload as JSON, or `None` when it was not JSON at all.
 *
 * `None` is a Garble and both Providers treat it as one: an interstitial served
 * as `text/event-stream` arrives here, and it must never be retried. Effect v4
 * has no `Schema.parseJson`, so this is the one place the try/catch lives.
 */
export const jsonOf = (event: SseEvent): Option.Option<unknown> => {
  try {
    return Option.some(JSON.parse(event.data) as unknown)
  } catch {
    return Option.none()
  }
}
