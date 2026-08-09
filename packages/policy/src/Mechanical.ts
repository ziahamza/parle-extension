/**
 * Layer 1 of the Exclusion List: the only layer that is complete.
 *
 * Everything here is a rule about the SHAPE of an address, not a fact about the
 * world, so it needs no source, cannot go stale, and cannot be missing an entry
 * — there is no `10.0.0.0/8` we forgot. That is why this layer, alone among the
 * four, is also what `SubjectIdentity.identify` consults: an address that fails
 * one of these rules is not a Subject at all. There is no public page behind
 * `http://192.168.1.1/`, so there is nothing to withhold and nothing for the
 * reader to override — the honest answer is "this is not a page the world can
 * have discussed", which is `Option.none`.
 *
 * The category exclusions (banking, webmail, …) deliberately do NOT collapse
 * into `none`, because those ARE real public pages: they must mint a Subject
 * URL so that the Withholding lands in Coverage with a reason, the panel can
 * offer "check anyway", and the reader can override.
 *
 * The private-range table is the one adapted from the Wayback Machine
 * extension's `utils.js` (AGPL-3.0, same as this repo). Its shipped version is
 * missing `172.16.0.0/12`, IPv6 `[::1]`, `.local`, and single-label hosts;
 * those gaps are not inherited here.
 */
import * as Option from "effect/Option"
import { Exclusion } from "./Exclusion.ts"

/** The only two schemes a Subject can live behind. */
const webSchemes: ReadonlySet<string> = new Set(["http:", "https:"])

/** Suffixes reserved for names that never resolve on the public internet. */
const internalSuffixes: ReadonlyArray<string> = [
  ".local",
  ".internal",
  ".corp",
  ".home.arpa",
  ".lan",
  ".intranet",
  ".private",
  ".test",
  ".invalid",
  ".example",
  ".localhost",
  ".onion",
  ".i2p"
]

const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Name the private range an IPv4 literal falls in, if any.
 *
 * Returns the range in CIDR notation rather than a boolean so the settings page
 * can say which rule fired — "192.168.0.0/16", not "private".
 */
const privateIpv4Range = (host: string): string | undefined => {
  const m = ipv4Pattern.exec(host)
  if (m === null) return undefined
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return undefined

  if (a === 0) return "0.0.0.0/8"
  if (a === 127) return "127.0.0.0/8"
  if (a === 10) return "10.0.0.0/8"
  if (a === 172 && b >= 16 && b <= 31) return "172.16.0.0/12"
  if (a === 192 && b === 168) return "192.168.0.0/16"
  if (a === 169 && b === 254) return "169.254.0.0/16"
  // CGNAT. Routable-looking, unreachable from outside the carrier, and the one
  // range most private-IP lists omit.
  if (a === 100 && b >= 64 && b <= 127) return "100.64.0.0/10"
  return undefined
}

/**
 * Name the private range an IPv6 literal falls in, if any.
 *
 * The host arrives bracketed from `URL.hostname`. Only the first hextet decides
 * every range we care about, so this reads that one group rather than expanding
 * the address — `fc00::/7` is "the top 7 bits are 1111110" and `fe80::/10` is
 * "the top 10 bits are 1111111010".
 */
const privateIpv6Range = (host: string): string | undefined => {
  if (!host.startsWith("[") || !host.endsWith("]")) return undefined
  const address = host.slice(1, -1).toLowerCase()

  if (address === "::1") return "::1/128"
  if (address === "::") return "::/128"
  // A leading `::` means the address begins with zero groups, so it is in the
  // reserved low block whatever follows.
  if (address.startsWith("::")) return "::/96"

  const first = address.split(":")[0]
  if (first === undefined || !/^[0-9a-f]{1,4}$/.test(first)) return undefined
  const bits = Number.parseInt(first, 16)
  if ((bits & 0xfe00) === 0xfc00) return "fc00::/7"
  if ((bits & 0xffc0) === 0xfe80) return "fe80::/10"
  return undefined
}

/**
 * Apply every mechanical rule to an already-parsed address.
 *
 * `None` means the address passed all of them — not that it is safe to look up,
 * only that it is a public web address.
 */
export const mechanical = (raw: string): Option.Option<Exclusion> => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    // Not an address. Reported as a scheme failure because that is the first
    // thing a reader would check, and there is no more specific truth available.
    return Option.some(Exclusion.cases.Scheme.make({ scheme: "" }))
  }

  const scheme = url.protocol.toLowerCase()
  if (!webSchemes.has(scheme)) return Option.some(Exclusion.cases.Scheme.make({ scheme }))

  // Credentials in the authority. Checked before anything about the host,
  // because the host being perfectly ordinary is exactly the dangerous case.
  if (url.username !== "" || url.password !== "") {
    return Option.some(Exclusion.cases.UserInfo.make({ host: url.hostname.toLowerCase() }))
  }

  let host = url.hostname.toLowerCase()
  while (host.endsWith(".") && host.length > 1) host = host.slice(0, -1)
  if (host.length === 0) return Option.some(Exclusion.cases.SingleLabelHost.make({ host }))

  const v6 = privateIpv6Range(host)
  if (v6 !== undefined) return Option.some(Exclusion.cases.PrivateAddress.make({ host, range: v6 }))

  const v4 = privateIpv4Range(host)
  if (v4 !== undefined) return Option.some(Exclusion.cases.PrivateAddress.make({ host, range: v4 }))

  const suffix = internalSuffixes.find((s) => host.endsWith(s))
  if (suffix !== undefined) return Option.some(Exclusion.cases.InternalSuffix.make({ host, suffix }))

  // No dot, therefore no public suffix, therefore a name only this network
  // resolves: `intranet`, `wiki`, `jira`, and `localhost` itself.
  if (!host.includes(".") && !host.startsWith("[")) {
    return Option.some(Exclusion.cases.SingleLabelHost.make({ host }))
  }

  return Option.none()
}

/** True when an address survives every mechanical rule. */
export const isWebAddress = (raw: string): boolean => Option.isNone(mechanical(raw))
