/**
 * Every sentence the settings page says, in one file.
 *
 * Separated from the drawing for two reasons that are not tidiness. This copy is
 * the **load-bearing mitigation**, not a caption: Chrome Web Store's Limited Use
 * terms permit collecting browsing activity only for "a user-facing feature
 * described prominently in the Product's Chrome Web Store page *and in the
 * Product's user interface*", and enforcement of the 2026 revision began on
 * 1 August 2026. Keeping the words where they can be read, reviewed and diffed
 * without reading DOM code is what lets that stay true through later edits.
 *
 * And it is the file where the vocabulary rule is enforceable by eye. Only five
 * terms in this project are reader-facing — Discussion, Digest, Finding, Spread,
 * Provider — and every other term in `CONTEXT.md` is engineering vocabulary that
 * must never appear here. There is no "Subject", no "Coverage", no "Withholding",
 * no "Enquiry", no "Lookup" and no "Exclusion List" in any string below.
 *
 * **Everything here is shorter than it was, and nothing true was dropped.** The
 * rule applied throughout: shorter must mean denser, never vaguer. Where a cut
 * would have lost a distinction the sentence was carrying, the sentence stayed;
 * where it only lost words, the words went. The detail that could not survive a
 * one-line control — the three claims this project measured and refuses to make,
 * and the facts about this particular artifact — moved into {@link LONGER},
 * which the page shows behind one click and the first-run screen links to. It
 * was moved, not deleted.
 *
 * The standing claim is `research/ticket-03 §7` almost verbatim, and it is
 * worded to survive being quoted back at us. Three things it deliberately does
 * NOT say: that your browsing is private; that we exclude addresses carrying
 * credentials; that we protect sensitive categories. Each of those was measured
 * and each is unsupportable, and {@link LONGER} says so in as many words.
 */

/** "Hacker News and Reddit" — a list a person would read aloud. */
const listOf = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? names[0] ?? ""
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** The heading and the standing disclosure, shown before any control. */
export const DISCLOSURE = {
  title: "What Parle sends",
  paragraphs: [
    "Parle sends the address of the page you are reading to Hacker News, Reddit and X, to see whether anyone has discussed it. They see it. It is not anonymous.",
    "It skips banks, mail, health, government, adult, social and private addresses, and addresses that visibly carry a token. It never sends what comes after the #.",
    "That is a list, so it will miss things. Read it below, add to it, override it, or turn automatic lookups off."
  ],
  /**
   * What is true of THIS artifact, said immediately under the standing claim.
   *
   * The paragraphs above are the research's wording and describe Parle as
   * designed — all three sites. ADR 0001 requires a flag that compiles X out
   * *entirely*, and in this build that flag is off, so the first paragraph as it
   * stands names a service this artifact never contacts. Over-disclosure is the
   * safer direction to be wrong in, but it is still wrong, and a disclosure that
   * can be shown to be inaccurate about something this checkable is worth less
   * on the point it is actually load-bearing for.
   *
   * The first-run screen carries the same correction, derived the same way.
   * Returns `null` once nothing is compiled out, rather than a sentence that
   * would then have to be maintained to stay true.
   */
  build: (absent: ReadonlyArray<string>, present: ReadonlyArray<string>): string | null =>
    absent.length === 0 || present.length === 0
      ? null
      : `In this build, the code that would ask ${
        listOf(absent)
      } is not included at all, so it is ${
        listOf(present)
      } that see the addresses of the pages you read.`
} as const

/**
 * The detail that used to be on the first-run screen, one click away instead.
 *
 * The first-run screen was ~410 words and read as a disclaimer defending
 * itself; a disclosure nobody finishes is not a disclosure. So it was cut to
 * the part that must be read *before* an address leaves the browser, and
 * everything else landed here, on the page a reader reaches from that screen's
 * own link and from every panel footer.
 *
 * **The three refusals are quoted as refusals.** Each is a claim this project
 * measured and found unsupportable (ticket 03 §7), and each is stated in the
 * form "Not X" so that no substring of this page can be read as making it.
 * Deleting them to save words would have been deleting the only place the
 * reader learns what the skip list cannot do.
 */
export const LONGER = {
  title: "The longer version",
  refuses: {
    title: "Three things Parle will not claim",
    items: [
      "Not “your browsing is private”. It is not. Every page you read that is not skipped produces requests to other companies carrying its address.",
      "Not “we exclude addresses carrying credentials”. The rules catch several common shapes. A short share link that looks like an ordinary address cannot be detected at all.",
      "Not “we protect sensitive categories”. A list of sites cannot cover health, internal company tools or documents, and the best lists available are measurably missing well-known providers."
    ]
  },
  build: {
    title: "In this build",
    items: [
      "Reddit is asked with your own Reddit cookies, because it answers nothing without them. Hacker News is asked with no account and no key.",
      "There is no server run by this project, and the extension never contacts one."
    ]
  }
} as const

export const AUTOMATIC = {
  title: "Automatic lookups",
  label: "Look pages up as I read them",
  on: "Pages are looked up as you open them. The toolbar button works everywhere.",
  off:
    // "every web page", not "every page": an address that is not a public web
    // page has no page for anyone to have discussed, and the panel offers no
    // button there rather than one that cannot work.
    "Nothing is sent as you browse. The toolbar button still looks up any web page, including skipped ones."
} as const

/**
 * The Front Door rule, in the reader's words and with its cost stated.
 *
 * The sentence under the switch says what the rule DOES rather than that it
 * exists, and it says the two things a reader would want to argue with: that
 * nothing is deleted, and that recent conversations are never touched. A
 * suppression the reader cannot picture is one they cannot disagree with.
 */
export const FRONT_DOOR = {
  title: "Site front pages",
  label: "Show every Discussion, even on site front pages",
  off:
    "On a site's front page — facebook.com rather than a page on it — old Discussions are folded behind one line you can open. Anything from the last month is shown as usual.",
  on:
    "Every Discussion is shown everywhere. On a site's front page that can mean dozens of conversations about unrelated things."
} as const

/**
 * One sentence per Network: what it does, and what it costs.
 *
 * Reddit and X both say plainly that they ride the reader's own session, and X
 * says whose account bears the consequence. ADR 0014 is explicit that this
 * disclosure is what stands in for a "Log in with…" flow we deliberately do not
 * build, and that with ambient access "if a Network's anti-abuse decides the
 * traffic looks automated, the enforcement lands on the reader's account rather
 * than on us." These are half as long as they were and that clause is intact,
 * because a settings page that softened it would be the whole reason the
 * decision was acceptable, removed.
 */
export const NETWORKS = {
  title: "Where Parle looks",
  intro: "Turn any of these off and Parle stops asking it, whether or not you open the panel.",
  hackernews: {
    name: "Hacker News",
    says:
      "Searches by address and title. Public, no account — it costs your own connection, not anyone's key."
  },
  reddit: {
    name: "Reddit",
    says:
      "Searches by address, using the Reddit session already in your browser. The request goes out as you, and shares your Reddit rate limit."
  },
  x: {
    name: "X",
    says:
      "Searches by address, using the X session already in your browser — there is no other way to ask. It goes out as you, so if X decides it looks automated your account is rate-limited, not ours. Asked only once another site has found a discussion of this page. Never posts, likes or follows."
  },
  compiledOut: "Not in this build."
} as const

/**
 * Connecting a Provider, and the one sentence about the key that cannot be softened.
 *
 * ADR 0004 makes this an upgrade rather than a requirement, so the section
 * opens by saying the product works without it. Everything about a Digest is
 * downstream of the reader choosing to connect something, and a settings page
 * that read as an upsell wall would be the accessible-to-everyone goal quietly
 * dropped.
 *
 * `stored` is the sentence this project is not allowed to be vague about. MV3
 * has no keychain — ADR 0014 already recorded that as the reason a Network
 * refresh token would be a *worse* credential store than the browser's own
 * cookie jar — so the key sits in the same settings document as everything
 * else, in plain text, readable by anything that can read the browser profile.
 * Saying "stored securely" would be false, and saying nothing would let the
 * reader assume it. Three things this copy therefore does NOT say: that the key
 * is encrypted, that it is protected, or that it is safer here than anywhere
 * else. It is three lines rather than five now; it says all three of those
 * things still.
 */
export const PROVIDER = {
  // "Digest" is the word the panel uses, so it is the word here. The sentence
  // under it is what makes the term self-explaining rather than jargon the
  // reader has to have read a glossary for.
  title: "Digests",
  intro:
    "A Digest is Parle's summary of what the discussions it found actually said. It needs an AI Provider you connect. Everything else on this page works whether or not you do.",
  /** The honesty clause. See the note above; it is not decoration. */
  stored:
    "Kept on this device as ordinary text — an extension has nowhere private to put a key, so anything that can read your browser's profile can read it. Use one you can revoke.",
  cost:
    "Writing one reads the comments of the discussions found on a page and sends them to whatever you connect. So the panel asks first, every time.",
  choose: "What Parle should ask",
  none: {
    name: "Nothing",
    says: "No Digests. Discussions are still found and listed."
  },
  byok: {
    name: "An API key of your own",
    says:
      "OpenAI, or anything that speaks the same shape — a local model, or another company's endpoint. This one keeps working because of your agreement with whoever issued the key, not ours with anyone.",
    key: "API key",
    keySave: "Save this key",
    keyHint: "Kept on this device, sent only to the address below.",
    baseUrl: "Address to send it to",
    baseUrlHint: "Empty means OpenAI. A local model might be http://localhost:8080/v1.",
    model: "Model",
    modelHint: "Empty asks for a small, current one.",
    saved: "Key saved.",
    missing: "Paste a key first."
  },
  onDevice: {
    name: "This browser's built-in model",
    says: "No key, no account, and the comments never leave this machine.",
    absent: "This browser does not offer one.",
    present: "This browser has one ready."
  },
  codex: {
    name: "ChatGPT",
    says:
      "Bills your own ChatGPT subscription. There is no sign-in button for it yet — signing in from an extension is unresolved on Safari — so it takes a token you already have. A rough edge, labelled as one.",
    token: "Access token",
    tokenSave: "Save this token",
    tokenHint: "Kept on this device, exactly like an API key.",
    model: "Model",
    saved: "Token saved."
  },
  forget: "Forget this key",
  forgotten: "Forgotten.",
  chosen: (name: string): string => `Parle will ask ${name}.`
} as const

export const SKIPPED = {
  title: "Pages Parle skips",
  /**
   * The honesty clause, and it is not decoration.
   *
   * Protection by enumeration fails on whatever was not enumerated. ADR 0005
   * makes that the reason the public claim is "we skip these" and never "your
   * browsing is private", and this sentence is where the reader is told the
   * shape of what they are relying on before they rely on it. "A floor, not a
   * guarantee" is the whole of it in four words.
   */
  incomplete:
    "A list is incomplete by nature. It will miss services nobody has told us about, and it cannot see a private share link that looks ordinary. A floor, not a guarantee.",
  /**
   * Two paragraphs, because these are two different kinds of thing and the
   * research is explicit that saying so is the difference between a claim we
   * can defend and one we cannot.
   *
   * The structural rules really are complete by construction — a scheme is or
   * is not `http(s)`, a host is or is not on a public suffix — so "cannot go out
   * of date" is true of them. Address-shape detection is not: ticket 03 §3
   * measured recall at roughly two thirds of the shapes anyone thought to test,
   * and found two shapes provably undecidable without a host rule, which is why
   * §7 lists "we exclude URLs carrying credentials" among the three things we
   * may not say. Both under one heading claiming completeness was that claim
   * with extra steps.
   */
  rules: {
    title: "Always skipped, by rule",
    says:
      "These need no list and cannot go out of date, because they are facts about the address: not a web page at all, on your own network, or a name that only exists inside it.",
    shapes:
      "Parle also skips addresses that visibly carry a password, a token, an email address or a long random code. That is pattern-matching, not a guarantee: a short share link that looks ordinary cannot be caught."
  },
  builtIn: {
    title: "The built-in list",
    says: "Sites Parle does not look up unless you say otherwise. Grouped by why they are here."
  },
  yours: { title: "Sites you added", empty: "None yet." },
  overridden: {
    title: "Built-in entries you turned off",
    says: "Looked up again, even though they are on the built-in list.",
    empty: "None yet."
  },
  paused: {
    title: "Sites you paused",
    says: "Paused from the panel, undone here or there. Not a judgement about the site.",
    empty: "None yet."
  },
  add: {
    label: "Add a site to skip",
    hint: "example.com, or example.com/private. Subdomains are covered.",
    action: "Skip this site",
    rejected: "That is not a site address."
  },
  allow: {
    label: "Look up a site anyway",
    hint: "Overrides the built-in list for one site.",
    action: "Look it up anyway"
  },
  remove: "Remove",
  resume: "Resume"
} as const

/** Categories as the reader reads them, not as the upstream sources name them. */
export const CATEGORY_TITLES = {
  banking: "Banks and financial accounts",
  webmail: "Mail",
  health: "Health",
  documents: "Documents and file shares",
  calendar: "Calendars and meetings",
  search: "Search engines",
  social: "Social sites Parle reads rather than asks",
  government: "Government",
  adult: "Adult"
} as const

/**
 * The two clearing controls, and the one clause each that tells them apart.
 *
 * ADR 0015 keeps these separate because their privacy properties are opposite,
 * and the whole value of the finer control is that a reader worried about the
 * second is not made to pay for the first. That only works if the difference is
 * legible in one reading, which is what "this is the record of what you read"
 * has to do on its own.
 */
export const FORGETTING = {
  title: "What this device remembers",
  everything: {
    action: "Forget everything",
    says: "Everything Parle knows about discussions it found, built from pages you had already opened."
  },
  lookupRecord: {
    action: "Forget only the record of what was looked up",
    says:
      // Names the front-door judgements too, because they are the same kind of
      // thing and are cleared by the same button: each one is only written after
      // Parle has looked an address up, so the set of them is a list of sites
      // you opened. Both are stored under a scrambled name, and neither can be
      // read back into an address.
      "The dated note of which addresses Parle asked about, kept so it does not ask twice — and which of them turned out to be a site's front page. This is the record of what you read, and it is stored scrambled."
  },
  kept: "Your settings are not affected by either.",
  done: "Done."
} as const

export const FOOTER = {
  version: (artifact: number): string => `Skip list, version ${artifact}.`,
  source: "Parle is AGPL-3.0. Everything on this page happens on this device."
} as const
