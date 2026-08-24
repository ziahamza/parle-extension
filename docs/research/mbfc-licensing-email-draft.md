# Draft: licensing enquiry to Media Bias/Fact Check

To: editor@mediabiasfactcheck.com
Subject: Licensing MBFC ratings for a free, open-source browser extension (Parle)

Hi,

I build Parle, a free and open-source (AGPL-3.0) browser extension that shows readers
what the internet has already said about the page they are reading — the Hacker News,
Reddit and Bluesky conversations about it, whether Wikipedia cites it, and what named
public raters say about its publisher. Chrome Web Store listing:
https://chromewebstore.google.com/detail/bbigpojahnmkdbdnbcmadnhbjlemibom

The publisher-context feature ships as a static dataset compiled into the extension —
no server, no accounts, no telemetry; the extension never phones home, which is why an
API subscription doesn't fit the architecture. Every rating is displayed with its
rater's name attached ("Lean Left — per AllSides" style), never as our own judgement,
with attribution and a link back to the rater.

Your Data API page mentions reduced arrangements for nonprofits, academics and open
projects. I'd like to ask about a license to compile MBFC's bias and factual-reporting
ratings into that redistributable offline artifact, refreshed at each release (roughly
monthly). Parle is noncommercial — no paid tier, no ads — and I'm aware you've
supported a browser extension before (the mbfcext project). Attribution, links back to
mediabiasfactcheck.com on every rating, and a visible credit are all easy commitments;
I'm happy to discuss terms that protect your licensing business, including excluding
the numeric scores and shipping only the categorical ratings.

Would something in this shape be possible, and if so, what would it cost?

Thanks for the work you do,
Hamza Zia
https://ziahamza.com/parle

---

*Notes (not part of the email): sent-from address should be the owner's personal or
project address. If MBFC declines, the same ask works for AllSides
(https://www.allsides.com/tools-services/bias-ratings-license-api) to replace the
stale 2019 community mirror the current artifact layer falls back to — see the
provenance block in packages/standing/data/standing.json.*
