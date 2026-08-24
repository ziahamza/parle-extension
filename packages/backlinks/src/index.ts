/**
 * Which trusted references cite this page.
 *
 * A Backlink is not a Mention: a Mention says a conversation concerns a
 * Subject, a Backlink says a reference work cites it. The package answers one
 * question, has no error channel, and classifies every way of not getting an
 * answer — see {@link ./Backlink.ts} and {@link ./Source.ts}.
 */
export {
  Backlink,
  BacklinkAnswer,
  backlinksOf,
  citedWith,
  isBounded,
  ReferenceSource
} from "./Backlink.ts"
export { type BacklinkSourceShape, candidateAddresses, classify, classifyCause } from "./Source.ts"
export { comparableAddress, matchingAddress, sameAddress, withoutScheme } from "./Address.ts"
export { Wikipedia } from "./Wikipedia.ts"
export { Refused, type Unanswered, Unusable } from "./Wire.ts"
