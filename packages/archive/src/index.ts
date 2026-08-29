/**
 * The Wayback Machine surface.
 *
 * One question — "what does the Internet Archive hold about this page?" — asked
 * at most twice per Subject, classified the way a Network Lookup is classified,
 * plus the pure decision the future auto-open setting will be built on.
 *
 * The Archive is not a Network: nothing was discussed there, so nothing here
 * produces a Discussion, a Mention or a Consultation, and this package
 * deliberately does not depend on `@parle/networks`. What it does borrow is the
 * doctrine — Silence, Refusal and Garble have opposite consequences and must
 * never be collapsed — which is why {@link Holding} has four cases and not a
 * nullable record.
 *
 * Namespaced exports, matching `@parle/networks`, so a caller writes
 * `Archive.Archive` and `Landing.decideLanding` and the file a name came from
 * is visible at the call site.
 */
export * as Archive from "./Archive.ts"
export * as Holding from "./Holding.ts"
export * as Landing from "./Landing.ts"
export * as Recording from "./Recording.ts"
export * as Timestamp from "./Timestamp.ts"
export * as Wire from "./Wire.ts"
