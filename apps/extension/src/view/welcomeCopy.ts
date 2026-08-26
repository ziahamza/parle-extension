/**
 * Every word of the first-run screen, in one file.
 *
 * Isolated for the same two reasons `settingsCopy.ts` is. It is the
 * **load-bearing mitigation** rather than a caption — Chrome Web Store's
 * Limited Use terms permit collecting browsing activity only for a feature
 * described prominently in the store listing *and in the product's own
 * interface* — and it is where the vocabulary rule is checkable by eye. Only
 * seven terms in this project are reader-facing (Discussion, Digest, Finding,
 * Spread, Provider, Standing, Archive) and none of the rest appears below.
 *
 * Two of those seven are deliberately absent from this screen, and that is a
 * decision rather than an omission. The Internet Archive and Wikipedia are asked
 * about a page only when the reader OPENS the panel on it — never as they browse
 * — so naming them in the one sentence that has to be read before any address
 * leaves the browser would lengthen the disclosure with something that is not
 * true of browsing. They are named on the settings page, under the standing
 * claim, where the archived-copy setting that WOULD make them fire on every
 * navigation also lives.
 *
 * **This screen is deliberately short.** It used to be ~410 words, including a
 * section headed "Three things Parle will not claim", and a disclosure nobody
 * finishes reading is a disclosure that was not made. Everything that was cut
 * is still true and still in the product: it moved to {@link LONGER} on the
 * settings page, one link away, rather than being deleted. What stayed here is
 * the part that has to be read *before* an address leaves the browser:
 *
 *   - where the address goes, by name, said before it happens;
 *   - that the skip list is a list, and will therefore miss things;
 *   - which of the three sites this artifact cannot contact at all.
 *
 * Nothing here is assembled from fragments at runtime except the two lists of
 * site names, which are derived from the build so they cannot drift out of
 * date. A sentence stitched together from clauses is one no reviewer reads.
 */

/** "Hacker News and Reddit" — a list a person would read aloud. */
const listOf = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? names[0] ?? ""
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

export const FIRST_RUN = {
  title: "What Parle sends",

  /**
   * The whole disclosure, in one sentence, naming the sites this build really
   * contacts rather than the three Parle contacts by design.
   *
   * Derived rather than written out because ADR 0001 compiles X out of this
   * artifact, and a claim that is checkably wrong about something this easy to
   * check is worth less on the point it is actually load-bearing for.
   */
  sends: (asked: ReadonlyArray<string>): string =>
    `Parle sends the address of the page you are reading to ${
      listOf(asked)
    }, to see whether anyone has discussed it. They see it. It is not anonymous.`,

  /**
   * The honesty clause, and it is one clause on purpose.
   *
   * ADR 0005: protection by enumeration fails on whatever was not enumerated,
   * which is why the public claim is "we skip these" and never "your browsing
   * is private". "so it will miss things" is the whole of that, and it beats
   * the paragraph it replaced by being read.
   */
  skips:
    "It skips banks, mail, AI chats, health, government, adult and private addresses — a list, so it will miss things.",

  /** What this build cannot do, or nothing once nothing is compiled out. */
  absent: (names: ReadonlyArray<string>): string | null =>
    names.length === 0 ? null : `${listOf(names)} is not in this build at all.`,

  ask: "How should Parle work?",
  on: "Look pages up automatically",
  off: "Only when I ask",

  /**
   * What the reader is told about their own answer.
   *
   * `undecided` says nothing is being looked up, because nothing is: a screen
   * that reads the same before and after answering has not really asked. The
   * `manual` line is where the toolbar button is promised, because that is the
   * state in which the promise is the reader's whole remaining way in.
   */
  said: {
    undecided: "Not chosen yet. Nothing is being looked up.",
    /**
     * Derived from the build like {@link FIRST_RUN.sends}, and for the same
     * reason: this file's own header promises the site names cannot drift, and
     * a hardcoded list here was the drift. The caller hands in the same list it
     * hands `sends`, so the two sentences on this screen cannot name different
     * sites.
     */
    automatic: (asked: ReadonlyArray<string>): string =>
      `Every page you read that is not skipped goes to ${listOf(asked)}. Parle also checks ` +
      "its own public code repository for a skip-list update at most once a day — a static file, " +
      "the same for everyone, carrying nothing about you.",
    manual:
      "Nothing about the pages you read is sent as you browse. To look up the page you are on, " +
      "click the Parle button in the browser toolbar — top right, next to the address bar — and " +
      "Parle asks about that page, once. You can change this any time in Settings. Either way, " +
      "Parle checks its own public code repository for a skip-list update at most once a day — a " +
      "static file, the same for everyone, carrying nothing about you."
  },

  /** The way to the long version. The detail moved; it was not dropped. */
  more: "The long version, and everything you can change"
} as const
