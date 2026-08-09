/**
 * The Provider a reader has when they have connected nothing.
 *
 * ADR 0004 says AI is an upgrade, not a dependency. The cheapest way to keep
 * that true is to make the absence of AI a Provider rather than the absence of
 * one: the key is always populated, the layer always builds, no wiring is
 * conditional, and "no Digest yet" arrives as `ProviderUnavailable` through the
 * same path as "your key expired". A missing service would instead surface as a
 * layer that cannot be constructed, and the discovery half of the product —
 * which needs no AI at all — would be taken down with it.
 *
 * It is also the fallback the on-device layer substitutes when the machine has
 * no model.
 */
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Provider, ProviderUnavailable } from "./Provider.ts"

export const layer: Layer.Layer<Provider> = Layer.succeed(
  Provider,
  Provider.of({
    id: "unconnected",
    model: "none",
    chat: () =>
      Stream.fail(
        new ProviderUnavailable({
          reason: "not-connected",
          detail: "no Provider has been connected"
        })
      )
  })
)
