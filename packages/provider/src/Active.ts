/**
 * Which of the four layers is behind the one key.
 *
 * The choice is read once, when the layer is built, and it produces a `Layer`
 * rather than a branch inside `chat` — so the decision exists in exactly one
 * place and cannot leak into calling code. `Layer.unwrap` is what makes that
 * possible: an Effect that yields a Layer becomes a Layer.
 *
 * The requirement channel is the union of all four branches' requirements, and
 * that is deliberate. Each seam has a cheap unconnected form
 * (`CodexAccess.layerUnconnected`, `OnDeviceHost.layerFromBrowser`), so
 * providing all of them costs nothing, and the alternative — a requirement set
 * that changes with a runtime value — would push the choice back out to every
 * call site, which is the thing being prevented.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as Byok from "./Byok.ts"
import * as Codex from "./Codex.ts"
import * as OnDevice from "./OnDevice.ts"
import { Provider } from "./Provider.ts"
import * as Unconnected from "./Unconnected.ts"

/** What the reader connected. Exactly one is active. */
export const Connection = Schema.Literals(["codex", "byok", "on-device", "none"])
export type Connection = typeof Connection.Type

/**
 * The active connection.
 *
 * A `Reference` rather than a service, so that reading it adds no requirement
 * and the default — "nothing connected" — needs no wiring at all.
 */
export const ActiveConnection: Context.Reference<Connection> = Context.Reference(
  "parle/ai/ActiveConnection",
  { defaultValue: (): Connection => "none" }
)

/** Everything the four branches between them require. */
export type Seams =
  | HttpClient.HttpClient
  | Byok.ByokAccess
  | Codex.CodexAccess
  | OnDevice.OnDeviceHost

const behind = (connection: Connection): Layer.Layer<Provider, never, Seams> => {
  switch (connection) {
    case "byok":
      return Byok.layer
    case "codex":
      return Codex.layer
    case "on-device":
      // A machine with no model substitutes the unconnected Provider rather
      // than failing to build, so the panel offers a connection instead of
      // rendering a construction failure nobody can act on.
      return OnDevice.orElse(Unconnected.layer)
    case "none":
      return Unconnected.layer
  }
}

/** The one Provider layer the application wires. */
export const layer: Layer.Layer<Provider, never, Seams> = Layer.unwrap(
  Effect.gen(function*() {
    const connection = yield* ActiveConnection
    return behind(connection)
  })
)
