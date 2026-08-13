/** Decode the complete Panel contract carried over the extension port. */
import type {
  Account,
  DigestOffer,
  DigestView,
  FindingView,
  Folded,
  Note,
  Panel,
  PanelComment,
  Restraint,
  Row,
  RowComments,
  Source,
  Tone
} from "../view/Panel.ts"
import type { Json } from "@parle/domain/Refine"
import { isBoolean, isNumber, isPlainObject, isString, propertyOf } from "@parle/domain/Refine"

type Decoder<A> = (raw: Json) => A | null

const field = (raw: Json, key: string): Json | undefined =>
  isPlainObject(raw) ? propertyOf(raw, key) : undefined

const text = (raw: Json, key: string): string | null => {
  const value = field(raw, key)
  return isString(value) ? value : null
}

const number = (raw: Json, key: string): number | null => {
  const value = field(raw, key)
  return isNumber(value) ? value : null
}

const boolean = (raw: Json, key: string): boolean | null => {
  const value = field(raw, key)
  return isBoolean(value) ? value : null
}

const nullableText = (raw: Json, key: string): string | null | undefined => {
  const value = field(raw, key)
  return value === null ? null : isString(value) ? value : undefined
}

const list = <A>(raw: Json | undefined, decode: Decoder<A>): ReadonlyArray<A> | null => {
  if (!Array.isArray(raw)) return null
  const decoded: Array<A> = []
  for (const item of raw) {
    const value = decode(item)
    if (value === null) return null
    decoded.push(value)
  }
  return decoded
}

const strings = (raw: Json | undefined): ReadonlyArray<string> | null =>
  list(raw, (value) => isString(value) ? value : null)

const tone = (value: Json | undefined): Tone | null =>
  value === "waiting" || value === "quiet" || value === "found" ||
  value === "refused" || value === "withheld" || value === "garbled" ? value : null

const note = (raw: Json): Note | null => {
  const valueTone = tone(field(raw, "tone"))
  const valueText = text(raw, "text")
  return valueTone === null || valueText === null ? null : { tone: valueTone, text: valueText }
}

const comment = (raw: Json): PanelComment | null => {
  const id = text(raw, "id")
  const parentId = nullableText(raw, "parentId")
  const depth = number(raw, "depth")
  const author = text(raw, "author")
  const body = text(raw, "text")
  const age = text(raw, "age")
  return id === null || parentId === undefined || depth === null || author === null || body === null || age === null
    ? null
    : { id, parentId, depth, author, text: body, age }
}

const rowComments = (raw: Json | undefined): RowComments | null | undefined => {
  if (raw === null) return null
  if (!isPlainObject(raw)) return undefined
  const tag = text(raw, "_tag")
  if (tag === "Reading") return { _tag: "Reading" }
  if (tag === "Unreadable") return { _tag: "Unreadable" }
  if (tag !== "Read") return undefined
  const comments = list(field(raw, "comments"), comment)
  const beyond = number(raw, "beyond")
  return comments === null || beyond === null ? undefined : { _tag: "Read", comments, beyond }
}

const row = (raw: Json): Row | null => {
  const key = text(raw, "key")
  const network = text(raw, "network")
  const networkName = text(raw, "networkName")
  const place = nullableText(raw, "place")
  const title = text(raw, "title")
  const score = number(raw, "score")
  const commentCount = number(raw, "commentCount")
  const age = text(raw, "age")
  const permalink = text(raw, "permalink")
  const tier = text(raw, "tier")
  const alsoSubmitted = number(raw, "alsoSubmitted")
  const comments = rowComments(field(raw, "comments"))
  if (key === null || (network !== "hackernews" && network !== "reddit" && network !== "x") ||
      networkName === null || place === undefined || title === null || score === null ||
      commentCount === null || age === null || permalink === null ||
      (tier !== "linked" && tier !== "passing") || alsoSubmitted === null || comments === undefined) return null
  return { key, network, networkName, place, title, score, commentCount, age, permalink, tier, alsoSubmitted, comments }
}

const folded = (raw: Json | undefined): Folded | null | undefined => {
  if (raw === null) return null
  if (raw === undefined) return undefined
  const says = text(raw, "says")
  const label = text(raw, "label")
  const rows = list(field(raw, "rows"), row)
  return says === null || label === null || rows === null ? undefined : { says, label, rows }
}

const account = (raw: Json): Account | null => {
  const place = text(raw, "place")
  const standing = text(raw, "standing")
  const valueTone = tone(field(raw, "tone"))
  return place === null || standing === null || valueTone === null ? null : { place, standing, tone: valueTone }
}

const restraint = (raw: Json | undefined): Restraint | null | undefined => {
  if (raw === null) return null
  if (raw === undefined) return undefined
  const kind = text(raw, "kind")
  const says = text(raw, "says")
  const kinds = new Set(["undecided", "automatic-off", "excluded", "site-paused", "over-budget", "networks-off", "switched-off", "front-door", "not-a-web-page"])
  if (kind === null || says === null || !kinds.has(kind)) return undefined
  switch (kind) {
    case "undecided": case "automatic-off": case "excluded": case "site-paused": case "over-budget":
    case "networks-off": case "switched-off": case "front-door": case "not-a-web-page": return { kind, says }
    default: return undefined
  }
}

const source = (raw: Json): Source | null => {
  const label = text(raw, "label")
  const permalink = text(raw, "permalink")
  const isComment = boolean(raw, "comment")
  return label === null || permalink === null || isComment === null ? null : { label, permalink, comment: isComment }
}

const finding = (raw: Json): FindingView | null => {
  const statement = text(raw, "statement")
  const contested = boolean(raw, "contested")
  const sources = list(field(raw, "sources"), source)
  return statement === null || contested === null || sources === null ? null : { statement, contested, sources }
}

const offer = (raw: Json | undefined): DigestOffer | null | undefined => {
  if (raw === null) return null
  if (raw === undefined) return undefined
  const kind = text(raw, "kind")
  const label = text(raw, "label")
  const says = text(raw, "says")
  if ((kind !== "write" && kind !== "again" && kind !== "connect") || label === null || says === null) return undefined
  return { kind, label, says }
}

const digest = (raw: Json | undefined): DigestView | null => {
  if (raw === undefined) return null
  const saysRaw = field(raw, "says")
  const says = saysRaw === undefined ? null : note(saysRaw)
  const findings = list(field(raw, "findings"), finding)
  const partial = boolean(raw, "partial")
  const wrote = nullableText(raw, "wrote")
  const digestOffer = offer(field(raw, "offer"))
  return says === null || findings === null || partial === null || wrote === undefined || digestOffer === undefined
    ? null
    : { says, findings, partial, wrote, offer: digestOffer }
}

const optionalNote = (raw: Json | undefined): Note | null | undefined =>
  raw === null ? null : raw === undefined ? undefined : note(raw) ?? undefined

export const decodePanel = (raw: Json): Panel | null => {
  const heading = text(raw, "heading")
  const address = text(raw, "address")
  const decodedRestraint = restraint(field(raw, "restraint"))
  const linked = list(field(raw, "linked"), row)
  const passing = list(field(raw, "passing"), row)
  const decodedFolded = folded(field(raw, "folded"))
  const accounts = list(field(raw, "accounts"), account)
  const stillLooking = boolean(raw, "stillLooking")
  const waitingOn = strings(field(raw, "waitingOn"))
  const foundNothing = boolean(raw, "foundNothing")
  const couldNotAsk = boolean(raw, "couldNotAsk")
  const answeredBy = strings(field(raw, "answeredBy"))
  const index = optionalNote(field(raw, "index"))
  const windowed = optionalNote(field(raw, "windowed"))
  const automatic = boolean(raw, "automatic")
  const decodedDigest = digest(field(raw, "digest"))
  if (heading === null || address === null || decodedRestraint === undefined || linked === null || passing === null ||
      decodedFolded === undefined || accounts === null || stillLooking === null || waitingOn === null ||
      foundNothing === null || couldNotAsk === null || answeredBy === null || index === undefined ||
      windowed === undefined || automatic === null || decodedDigest === null) return null
  return { heading, address, restraint: decodedRestraint, linked, passing, folded: decodedFolded, accounts,
    stillLooking, waitingOn, foundNothing, couldNotAsk, answeredBy, index, windowed, automatic, digest: decodedDigest }
}
