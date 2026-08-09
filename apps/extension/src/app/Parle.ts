/**
 * The application Layer the background service worker is built from.
 *
 * Two halves, deliberately separable. `Pipeline.on` is everything that can be
 * driven from a test — the Networks, the policy, the two stores, the Enquiry
 * and the Board — parameterised by its platform and its HTTP client. This file
 * supplies the real ones and adds the extension surface, which cannot be built
 * outside a browser because it is the browser.
 *
 * Splitting it that way is what lets `Pipeline.test.ts` exercise the graph as
 * it actually ships rather than a hand-assembled lookalike, which is the kind
 * of test that stays green while the real wiring rots.
 *
 * It takes its platform rather than reaching for it because of MV3's first-turn
 * rule: the listeners are attached by `armExtension()` before the runtime is
 * built, so what this receives is a platform that has *already been listening*
 * for however long the layer took to come up. See `@parle/browser`'s `Relay.ts`
 * for why that ordering is not optional.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { WebExt } from "@parle/browser/WebExtApi"
import { type ArmedExtension, Extension } from "../platform/Extension.ts"
import * as Client from "./Client.ts"
import * as Pipeline from "./Pipeline.ts"

/** Everything the background service worker needs, and nothing it does not. */
export const ParleLayer = (attached: ArmedExtension) =>
  Layer.mergeAll(
    Pipeline.on(Layer.effect(WebExt, Effect.succeed(attached.platform)), Client.layer),
    Extension.layerFrom(attached)
  )
