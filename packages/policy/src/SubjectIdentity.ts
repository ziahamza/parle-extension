/**
 * The only minter of `SubjectUrl` in the system.
 *
 * Every key everywhere — Lookups, the Local Discussion Cache, Mentions, the
 * Discussion Index probe, a Shared Digest request — is a `SubjectUrl`, and a
 * `SubjectUrl` can only be obtained from here. That is what makes "every key
 * provably went through one rules version" a property of the type system rather
 * than a code-review convention, and it is why {@link SubjectIdentity} exposes
 * `rulesVersion`: an artifact built under different rules must be ignored
 * wholesale rather than probed with keys it cannot have been built from.
 *
 * **What `None` means, and what it deliberately does not.**
 *
 * `identify` returns `None` for an address that is not a page the world can
 * have discussed: an unparseable string, a `chrome://` URL, a private or
 * link-local literal, a single-label or internal hostname, an address carrying
 * userinfo. Those are the MECHANICAL layer of the Exclusion List — the only
 * layer that is complete by construction — and for them "not a Subject" is the
 * whole truth.
 *
 * A page on a listed domain is emphatically NOT one of those. `chase.com` is a
 * real public page that other people can and do discuss; it must mint a Subject
 * URL so that the decision not to ask about it lands in Coverage as a
 * Withholding with a reason, so the panel can offer "excluded — check anyway?",
 * and so the reader can override it. Collapsing category exclusions into `None`
 * here would make them invisible and unoverridable, which is the exact failure
 * ADR 0005 spends its longest section arguing against.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Alias, AliasEvidence, RulesVersion, SubjectUrl } from "@parle/domain/Subject"
import { canonicalize, rulesVersion } from "./Canonical.ts"
import { isWebAddress } from "./Mechanical.ts"

const version = RulesVersion.make(rulesVersion)

/**
 * The other addresses our own rules say point at the same Subject.
 *
 * A connector's "who submitted this address" question takes the whole alias set
 * rather than one string, because a Network holds whatever URL the submitter
 * pasted: `www.example.com/x`, `http://example.com/x`, `youtu.be/ID`. Searching
 * only the elected address turns every aliased site into a systematic
 * strong-tier false negative — a Linked Mention silently demoted to nothing,
 * which is the one failure the reader can never see.
 *
 * Derived from the rules alone, so every Alias here carries `Canonicalized`
 * evidence. Redirects the browser traversed and a Network's own submitted URL
 * are stronger evidence and arrive from elsewhere.
 */
const derivedAliases = (canonical: string): ReadonlyArray<string> => {
  let url: URL
  try {
    url = new URL(canonical)
  } catch {
    return []
  }
  const out = new Set<string>()
  const host = url.hostname

  /**
   * Ordered by how likely a submitter actually pasted it, not by tidiness.
   *
   * The order is load-bearing because a connector asking about every Alias is
   * unbounded work driven by data we do not control, so each one caps the
   * question — Hacker News at four addresses. `https://www.` is far and away
   * the commonest submitted form and must not fall outside that cap behind two
   * `http://` variants nobody has pasted since about 2016. Getting this wrong
   * costs Linked Mentions, which is the one failure a reader cannot see.
   */
  const origins = [`https://${host}`, `https://www.${host}`, `http://${host}`, `http://www.${host}`]
  // Both bare forms first, then both trailing-slash twins. Servers treat the
  // two as one document and submitters paste both, but the bare form is the
  // one a canonical tag and a share button produce.
  for (const origin of origins) out.add(`${origin}${url.pathname}${url.search}`)
  if (url.pathname !== "/" && url.search === "") {
    for (const origin of origins) out.add(`${origin}${url.pathname}/`)
  }

  if (host === "youtube.com" && url.pathname === "/watch") {
    const id = new URLSearchParams(url.search).get("v")
    if (id !== null) {
      out.add(`https://youtu.be/${id}`)
      out.add(`https://m.youtube.com/watch?v=${id}`)
      out.add(`https://www.youtube.com/shorts/${id}`)
    }
  }

  out.delete(canonical)
  return [...out]
}

export class SubjectIdentity extends Context.Service<SubjectIdentity, {
  /** The version of the rules that mint every key this service returns. */
  readonly rulesVersion: number
  /**
   * Elect the address that represents this page, or `None` if there is no page.
   *
   * Total: an unparseable string, an internal hostname and a `chrome://` URL
   * are one answer, because the caller's next move is identical for all three.
   */
  readonly identify: (raw: string) => Effect.Effect<Option.Option<SubjectUrl>>
  /** The addresses our rules say also point here. Never a network request. */
  readonly aliasesOf: (subject: SubjectUrl) => Effect.Effect<ReadonlyArray<Alias>>
}>()("parle/policy/SubjectIdentity") {
  static readonly layer = Layer.effect(
    SubjectIdentity,
    Effect.gen(function*() {
      const identify = Effect.fn("SubjectIdentity.identify")(function*(raw: string) {
        // Mechanical rules run on the RAW address, because canonicalization
        // strips userinfo and would otherwise launder a credentialed URL into
        // an ordinary-looking one.
        if (!isWebAddress(raw)) return Option.none<SubjectUrl>()
        const canonical = canonicalize(raw)
        if (canonical === undefined) return Option.none<SubjectUrl>()
        // Canonicalization can move the address — an AMP proxy unwraps to the
        // publisher, which may itself be excluded — so the rules run again on
        // what we would actually send.
        if (!isWebAddress(canonical)) return Option.none<SubjectUrl>()
        return Option.some(SubjectUrl.make(canonical))
      })

      const aliasesOf = Effect.fn("SubjectIdentity.aliasesOf")(function*(subject: SubjectUrl) {
        return derivedAliases(subject).map((url) =>
          Alias.make({ url, evidence: AliasEvidence.cases.Canonicalized.make({ rulesVersion: version }) })
        )
      })

      return SubjectIdentity.of({ rulesVersion, identify, aliasesOf })
    })
  )
}
