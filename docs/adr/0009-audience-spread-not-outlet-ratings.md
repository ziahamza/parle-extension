# We report where a page travelled, not how biased its publisher is

The bias dimension is delivered as **Spread** — which communities a Subject was shared into, how often, and how reception differed between them — derived from the Reddit and HN crawl we already run for the Discussion Index. We do **not** assign left/right/centre ratings to publications.

## Why

An outlet rating is a judgement we would have to defend; a spread pattern is an observed fact. "This page was posted to r/conservative three times and r/politics once, and the top comments in each disagree about X" is checkable, specific to *this page* rather than a permanent label on a publication, and consistent with [ADR 0006](./0006-the-digest-reports-it-does-not-adjudicate.md)'s rule that we report rather than adjudicate.

It is also free. Licensed ratings (AllSides, Media Bias/Fact Check, Ad Fontes) cost a negotiation; our own methodology costs an ongoing defence of it. Spread costs nothing beyond data we are already collecting.

## Consequences

- We do not offer the familiar left/right bar most people recognise from Ground News. The Spread view has to earn its own legibility — this is a design problem, and a hard one, because "three subreddits" is less immediately graspable than a coloured bar.
- Spread quality depends directly on Reddit crawl coverage, which is unresolved (see the map). Thin coverage makes Spread misleading rather than merely absent — a page that *looks* like it only reached one community because we only crawled one. Spread must not be shown when coverage is known to be partial.
- Licensed outlet ratings remain a possible independent static artifact and a separate effort. Nothing here forecloses them.
