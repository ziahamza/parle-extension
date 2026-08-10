# Parle

A browser extension that shows what the internet has already said about the page you are reading, so reading is a more informed and less solitary act.

> **Reader-facing terms are only these five**: Discussion, Digest, Finding, Spread, Provider. Everything else below is engineering vocabulary and must never appear in the UI.

## Language

### The page being read

**Subject**:
A web page, identified by the set of addresses believed to point at one reading of it. It exists whether or not anyone currently has it open.
_Avoid_: page, article, target, current tab

**Subject URL**:
The one Alias elected to represent a Subject, produced by a specific numbered version of the canonicalization rules and used as the key everywhere. Two components running different rule versions produce different keys for the same page.
_Avoid_: url, link, permalink, canonical url

**Alias**:
One address believed to point at a Subject, carrying the evidence for that belief — a canonicalization rule, a redirect the reader's own browser traversed, or a Network's own submitted URL. A Subject's Aliases grow and are revised; its Subject URL is whichever one the rules currently elect.
_Avoid_: variant, duplicate, synonym, redirect

**Reading**:
One reader's encounter with one Subject in one top-level frame — from when the address settles until it changes — carrying what caused it and which Network, if any, they arrived from.
_Avoid_: visit, session, pageview, tab

**Enquiry**:
The work of finding out about one Subject: everything asked and learned, owned by the Subject rather than by any Reading. Several Readings share one Enquiry, and it outlives the Reading that started it.
_Avoid_: query, job, discovery run, request

### What we gather

**Network**:
A social site whose conversations we read — Hacker News, Reddit, X.
_Avoid_: platform, source, provider, site

**Discussion**:
One conversation on a Network — a Hacker News item, a Reddit post, an X thread — together with its replies, identified by that Network *and* its own identifier there. It belongs to no Subject.
_Avoid_: thread, post, comment section, conversation

**Mention**:
The claim that a Discussion concerns a Subject, together with the evidence for it. The evidence decides the tier; the tier is never a property of the Discussion.
_Avoid_: hit, result, match, association, relevance

**Linked Mention**:
A Mention evidenced by the Discussion's own submitted URL matching one of the Subject's Aliases, or by the reader having arrived here from that Discussion. The strong tier — this conversation is about this page — and the only tier that discharges the disclosure argument permitting an X Lookup.
_Avoid_: exact match, direct hit, tier 1

**Passing Mention**:
A Mention evidenced only by the Subject's address appearing inside a Discussion's comments or body while that Discussion is about something else.
_Avoid_: inbound link, backlink, weak link, tier 1.5

~~**Topical Mention**~~ — **removed 2026-08-11.**
A Mention evidenced only by a keyword search on the Subject's title. Deleted rather than improved: its evidence was "something with a similar title exists", which on `example.com` produced nine rows including "Ask HN: Best registrar only and why", and the panel had to caption it "matched by title — not provably this page". A caption apologising for the rows beneath it is the product admitting the rows should not be there. Its removal also took the per-page request count from six to three, deleted the only reason a Lookup ever needed the page's title (and so the only thing that could leak one), and emptied the front-door rule's reason for withholding.

**Observation**:
One reading of a Discussion's mutable numbers — score, comment count, whether it still appears — stamped with the moment we received it, because no Network tells us when they were true. Observations are never corrected, only superseded.
_Avoid_: snapshot, metadata, stats, reading

**Movement**:
What changed between two Observations of one Discussion: confirmed, corrected, withdrawn (it stopped appearing in an answer), or removed (the Network says so). Omission from an answer licenses withdrawn and nothing stronger.
_Avoid_: diff, change, update, drift

### Asking, and not asking

**Lookup**:
One live request to one Network asking one question about a Subject — which Discussions submitted this address, or which Discussions match this title. The two questions fail independently and are paced, counted, and cached separately.
_Avoid_: fetch, query, search, request

**Coverage**:
Everywhere we turned for evidence about a Subject on this Enquiry, and what came back from each, so that an empty panel always means something specific. It accounts for every place at every moment; there is no place it can fail to mention.
_Avoid_: status, results, completeness, health

**Silence**:
A Network answered about a Subject and had nothing. The only Lookup outcome that is evidence about the world rather than about us, and the only one it is ever safe to cache.
_Avoid_: empty, zero results, no hits, miss

**Refusal**:
A Network could not answer, or we could not hear the answer — not signed in, rate-limited, forbidden, timed out, or the worker was killed mid-flight. A fact about the attempt, never about the Subject, and never cached.
_Avoid_: error, failure, exception, outage

**Withholding**:
A Lookup we deliberately did not issue, inseparable from the reason the reader is owed for it — excluded, paused, kill-switched, compiled out, over budget, or no Linked Mention found yet. Restraint made visible, not a failure.
_Avoid_: skip, blocked, disabled, suppressed

**Garble**:
A Network answered and the answer was not usable — unparseable, truncated, or an interstitial served as success. Never retried, never cached, and never mistaken for a Silence.
_Avoid_: parse error, bad response, malformed, corrupt

**Exclusion List**:
The places we never issue a Lookup for automatically — private and non-web addresses, URLs carrying credentials, sensitive categories, and destinations where searching returns nothing useful. Enumerated, therefore incomplete by nature.
_Avoid_: blacklist, blocklist, denylist, filter

### What the reader's machine remembers

**Local Discussion Cache**:
The reader's own store of Mentions and Observations, built only from Networks they were already on. It holds pointers and numbers, never content, and because it is filled by Harvest and never by Lookups it discloses nothing about what else they read.
_Avoid_: local index, history, store, db

**Harvest**:
Recording, from a Network page the reader is already on, the Mentions its links imply — keyed on the address each link actually resolves to, never the tracking URL that was clicked.
_Avoid_: scrape, crawl, collect, index

**Lookup Record**:
The record that we intended to ask a Network about a Subject and when, kept only so we do not ask again. It is a history of what the reader read, so it is written under opaque keys, kept briefly, and cleared separately from the Local Discussion Cache.
_Avoid_: cache, log, history, ledger

### The Digest

**Brief**:
The exact material a Digest is written from: the Discussions selected, the comments taken from them, and their Observations at that moment. It is supplied *to* a Digest and never claimed *by* one.
_Avoid_: corpus, context, input, sources

**Digest**:
A set of Findings summarising the whole of a Subject's Discussions, written from a Brief and accountable to it, and marked complete or partial. It is rewritten as the Discussions grow; the reader always sees the current one, never a diff against an earlier one. Every claim in it traces to a Discussion in that Brief.
_Avoid_: summary, TL;DR, overview

**Finding**:
One attributed statement in a Digest, always carrying at least one Citation. A Finding may report a claim on the Subject as contested — the only judgement a Digest makes, and always someone else's.
_Avoid_: point, claim, item, bullet, insight

**Citation**:
A pointer from a Finding to the specific Discussion and comment evidencing it, resolvable inside that Digest's Brief and separately checkable as still live.
_Avoid_: reference, link, attribution, evidence

**Digest Origin**:
Where a Digest was written: **Shared**, by us for a Subject over the popularity threshold and served to every reader of that page, or **Local**, by the reader's own Provider and never leaving their machine. Not two kinds of Digest — one kind, two writers.
_Avoid_: cached digest, public digest, server digest, client digest, private digest

**Watermark**:
The Observations in a Digest's Brief — what its Discussions looked like when it was written. Internal only: comparing it against current Observations is how we decide a Digest is stale enough to rewrite. It is never shown to the reader and never described as a horizon they have.
_Avoid_: timestamp, version, etag, last look, delta

### AI and artifacts

**Provider**:
A source of AI capability the reader has connected — their ChatGPT subscription, their own API key, or their browser's on-device model. Exactly one is active; no caller branches on which, and every Digest records which one wrote it.
_Avoid_: model, backend, LLM, integration

**Discussion Index**:
A shipped, compact record of addresses known to have at least one Discussion. It can suspect and it can be silent; it can never say a Subject has none — so it may only make a Lookup faster, or make us distrust an unexpected Silence.
_Avoid_: bloom filter, cache, database, prefilter

**Spread**:
Which communities a Subject travelled into, how often, and how reception differed — an observed pattern of travel, never a rating of its publisher, and meaningless apart from the Coverage it was observed over.
_Avoid_: bias, lean, reach, virality
