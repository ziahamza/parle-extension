// Step 1b: deliberate seeds — (a) known classics resubmitted over years under a stable
// title (the counterexample set), (b) generic/everlasting root pages as a labelled contrast.
import { writeFileSync, readFileSync } from "node:fs";

const CLASSICS = [
  // Paul Graham essays
  "http://paulgraham.com/greatwork.html",
  "http://paulgraham.com/bus.html",
  "http://paulgraham.com/makersschedule.html",
  "http://paulgraham.com/ds.html",
  "http://paulgraham.com/avg.html",
  "http://paulgraham.com/hs.html",
  "http://paulgraham.com/hwh.html",
  "http://paulgraham.com/love.html",
  "http://paulgraham.com/word.html",
  "http://paulgraham.com/submarine.html",
  "http://paulgraham.com/nerds.html",
  "http://paulgraham.com/wealth.html",
  "http://paulgraham.com/lies.html",
  "http://paulgraham.com/writing44.html",
  "http://paulgraham.com/disagree.html",
  // Reflections on Trusting Trust
  "https://www.cs.cmu.edu/~rdriley/487/papers/Thompson_1984_ReflectionsonTrustingTrust.pdf",
  "https://dl.acm.org/doi/10.1145/358198.358210",
  // danluu.com
  "https://danluu.com/input-lag/",
  "https://danluu.com/bimodal-compensation/",
  "https://danluu.com/people-matter/",
  "https://danluu.com/empirical-pl/",
  "https://danluu.com/productivity-velocity/",
  "https://danluu.com/wat/",
  "https://danluu.com/octopus-interview/",
  "https://danluu.com/everything-is-broken/",
  "https://danluu.com/why-benchmark/",
  "https://danluu.com/程序员/",
  // Other perennials
  "https://norvig.com/21-days.html",
  "https://grugbrain.dev/",
  "https://www.akkadia.org/drepper/cpumemory.pdf",
  "https://mcfunley.com/choose-boring-technology",
  "https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/",
  "https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/",
  "https://www.joelonsoftware.com/2002/11/11/the-law-of-leaky-abstractions/",
  "https://idlewords.com/talks/website_obesity.htm",
  "https://www.cs.virginia.edu/~robins/YouAndYourResearch.html",
  "https://www.stilldrinking.org/programming-sucks",
  "https://dreamsongs.com/RiseOfWorseIsBetter.html",
  "https://www.kalzumeus.com/2010/06/17/falsehoods-programmers-believe-about-names/",
  "https://ciechanow.ski/gears/",
  "https://ciechanow.ski/mechanical-watch/",
  "https://ciechanow.ski/gps/",
  "https://ciechanow.ski/lights-and-shadows/",
  "https://www.sicpdistilled.com/",
  "https://aphyr.com/posts/340-acing-the-technical-interview",
  "https://tonsky.me/blog/disenchantment/",
  "https://gwern.net/scaling-hypothesis",
  "https://www.gnu.org/philosophy/free-sw.html",
  "https://xkcd.com/927/",
  "https://blog.codinghorror.com/the-best-code-is-no-code-at-all/",
  "https://www.usenix.org/system/files/1311_05-08_mickens.pdf",
  "https://web.mit.edu/~simsong/www/ugh.pdf",
  "https://en.wikipedia.org/wiki/Ship_of_Theseus",
];

const GENERIC_ROOTS = [
  "https://www.facebook.com/",
  "https://github.com/",
  "https://www.bankofamerica.com/",
  "https://news.ycombinator.com/",
  "https://www.nytimes.com/",
  "https://twitter.com/",
  "https://www.google.com/",
  "https://www.reddit.com/",
  "https://stackoverflow.com/",
  "https://www.apple.com/",
  "https://openai.com/",
  "https://www.microsoft.com/",
  "https://aws.amazon.com/",
  "https://www.tesla.com/",
  "https://www.wikipedia.org/",
  "https://arxiv.org/",
  "https://www.bbc.com/",
  "https://www.theguardian.com/",
  "https://slack.com/",
  "https://www.notion.so/",
  "https://vercel.com/",
  "https://www.cloudflare.com/",
  "https://www.linkedin.com/",
  "https://gitlab.com/",
  "https://www.paypal.com/",
  "https://www.netflix.com/",
  "https://www.spotify.com/",
  "https://www.anthropic.com/",
  "https://www.wsj.com/",
  "https://www.amazon.com/",
  "https://www.craigslist.org/",
  "https://www.yahoo.com/",
  "https://duckduckgo.com/",
  "https://www.mozilla.org/",
  "https://www.python.org/",
  "https://www.rust-lang.org/",
  "https://www.ycombinator.com/",
  "https://www.airbnb.com/",
  "https://www.uber.com/",
  "https://www.stripe.com/",
];

const existing = JSON.parse(readFileSync(process.argv[2], "utf8"));
const seen = new Set(existing.map((r) => r.url));
const extra = [];
for (const url of CLASSICS)
  if (!seen.has(url)) extra.push({ url, hnTitle: null, source: "classic", objectID: null });
for (const url of GENERIC_ROOTS)
  if (!seen.has(url)) extra.push({ url, hnTitle: null, source: "generic_root", objectID: null });

writeFileSync(process.argv[3], JSON.stringify([...existing, ...extra], null, 2));
console.error(`seeds added: ${extra.length}; total ${existing.length + extra.length}`);
