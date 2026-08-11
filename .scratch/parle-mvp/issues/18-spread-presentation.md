# How is Spread computed and shown so it's legible and not misleading?

Type: grilling
Status: open
Blocked by: 14, 16

## Question

Blocked on ticket 14 and ticket 16 — Spread is derived from Reddit crawl coverage, so it cannot be designed before we know what coverage exists.

[ADR 0009](../../../docs/adr/0009-audience-spread-not-outlet-ratings.md) delivers the bias dimension as **where a page travelled**, not a rating of its publisher. It also flags the two hard problems, both of which live here.

- **Legibility.** The ADR concedes that "three subreddits" is far less immediately graspable than Ground News's coloured left/right bar. What is the visual and verbal form that makes a spread pattern land in two seconds? This is the harder half of the ticket, and failing it makes the feature decorative.
- **Partial coverage.** [ADR 0009](../../../docs/adr/0009-audience-spread-not-outlet-ratings.md) is explicit that thin crawl coverage makes Spread **misleading rather than merely absent** — a page looks like it only reached one community because we only crawled one. What is the measurable coverage bar below which Spread is hidden entirely, and how do we know we're above it?
- **What's computed.** Which communities, how many times, when, and with what reception. Does reception mean score, comment volume, or something about the comments themselves? Does the *difference* between rooms get surfaced, which is the actual insight, or just the list?
- **Communities as such.** Subreddits are natural units; Hacker News is one room; X has none. Does Spread span Networks or is it Reddit-only in practice?
- **Not becoming a rating.** The moment we aggregate subreddits into "left" and "right" we have rebuilt the thing [ADR 0009](../../../docs/adr/0009-audience-spread-not-outlet-ratings.md) rejected, wearing a disguise. Where exactly is that line, and what stops the design drifting across it?

**The decision:** what Spread computes, when it is shown at all, and how it is presented.
