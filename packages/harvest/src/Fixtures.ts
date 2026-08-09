/**
 * Network pages to parse offline.
 *
 * Shipped beside the parsers rather than hidden under a test directory, for the
 * reason `@parle/networks` ships its recorded exchanges: a fixture that lives
 * next to the code it fixes is one that gets updated when the code moves, and
 * any downstream package testing its own behaviour against a harvest needs the
 * same pages.
 *
 * These are **reconstructed**, not captured, and the distinction matters. They
 * are trimmed to the structures the parsers are anchored on, in the shapes each
 * Network was serving as of 2026-08-08: Hacker News' `tr.athing` rows with the
 * `subtext` row that follows them, Reddit in BOTH dialects — `<shreddit-post>`
 * on `reddit.com` and `div.thing[data-fullname]` on `old.reddit.com` — and X's
 * `article[data-testid="tweet"]`. Treat them as a specification of what the
 * parsers accept rather than as evidence of what these sites send, and expect
 * to re-capture them the first time a Network reskins. That is not a weakness
 * of the fixtures; it is the event {@link ./Page.ts}'s `Legibility` exists to
 * make loud.
 *
 * Two properties are deliberately built in and are the tests rather than the
 * scenery. Every X link is a `t.co`, because that is the case ADR 0012 says the
 * whole cache exists to get right. And every page carries at least one item
 * that must yield nothing — an Ask HN with no outbound link, a Reddit self
 * post, a post with no link at all — because a parser that produces something
 * for those is a parser producing Mentions about the Network itself.
 */

/** The front page: three stories, one of which is an Ask HN with no link. */
export const hackerNewsListing = `<html><body><center><table id="hnmain">
<tr><td><table class="itemlist">
<tr class='athing submission' id='40786237'>
  <td align="right" valign="top" class="title"><span class="rank">1.</span></td>
  <td valign="top" class="votelinks"><center><a id='up_40786237' href='vote?id=40786237&amp;how=up'><div class='votearrow'></div></a></center></td>
  <td class="title"><span class="titleline"><a href="https://www.nature.com/articles/d41586-024-02012-5">Not all &#39;open source&#39; AI models are open: here&#39;s a ranking</a><span class="sitebit comhead"> (<a href="from?site=nature.com"><span class="sitestr">nature.com</span></a>)</span></span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">
  <span class="score" id="score_40786237">127 points</span> by <a href="user?id=weinzierl" class="hnuser">weinzierl</a>
  <span class="age" title="2024-06-25T09:17:08 1719307028"><a href="item?id=40786237">3 hours ago</a></span>
  | <a href="hide?id=40786237">hide</a> | <a href="item?id=40786237">18&nbsp;comments</a>
</span></td></tr>
<tr class="spacer"></tr>

<tr class='athing submission' id='40802874'>
  <td align="right" valign="top" class="title"><span class="rank">2.</span></td>
  <td class="title"><span class="titleline"><a href="https://example.com/a-second-story?utm_source=hn">A second story</a><span class="sitebit comhead"> (<a href="from?site=example.com"><span class="sitestr">example.com</span></a>)</span></span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">
  <span class="score" id="score_40802874">4 points</span> by <a href="user?id=rntn" class="hnuser">rntn</a>
  <span class="age" title="2024-06-26T18:21:54 1719426114"><a href="item?id=40802874">1 hour ago</a></span>
  | <a href="item?id=40802874">discuss</a>
</span></td></tr>
<tr class="spacer"></tr>

<tr class='athing submission' id='36615023'>
  <td align="right" valign="top" class="title"><span class="rank">3.</span></td>
  <td class="title"><span class="titleline"><a href="item?id=36615023">Ask HN: Are there &#8220;open&#8221; source AI translation models?</a></span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">
  <span class="score" id="score_36615023">2 points</span> by <a href="user?id=xrd" class="hnuser">xrd</a>
  <span class="age" title="2023-07-06T12:54:29 1688648069"><a href="item?id=36615023">2 days ago</a></span>
  | <a href="item?id=36615023">3&nbsp;comments</a>
</span></td></tr>
</table></td></tr>
</table></center></body></html>
`

/** One thread: the submission, plus two comments carrying outside addresses. */
export const hackerNewsItem = `<html><body><center><table id="hnmain">
<tr><td><table class="fatitem">
<tr class='athing submission' id='40786237'>
  <td align="right" valign="top" class="title"><span class="rank"></span></td>
  <td class="title"><span class="titleline"><a href="https://www.nature.com/articles/d41586-024-02012-5">Not all &#39;open source&#39; AI models are open: here&#39;s a ranking</a><span class="sitebit comhead"> (<a href="from?site=nature.com"><span class="sitestr">nature.com</span></a>)</span></span></td>
</tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline">
  <span class="score" id="score_40786237">131 points</span> by <a href="user?id=weinzierl" class="hnuser">weinzierl</a>
  <span class="age" title="2024-06-25T09:17:08 1719307028"><a href="item?id=40786237">4 hours ago</a></span>
  | <a href="item?id=40786237">19&nbsp;comments</a>
</span></td></tr>
</table>
<table class="comment-tree">
<tr class='athing comtr' id='40787001'>
  <td><table><tr><td class="default"><div style="margin-top:2px; margin-bottom:-10px;">
    <span class="comhead"><a href="user?id=someone" class="hnuser">someone</a></span>
  </div><br><div class="comment"><div class="commtext c00">
    The methodology is described here: <a href="https://opening-up-chatgpt.github.io/" rel="nofollow">https://opening-up-chatgpt.github.io/</a><p>See also <a href="https://example.org/paper.pdf" rel="nofollow">example.org/paper.pdf</a>
  </div></div></td></tr></table></td>
</tr>
<tr class='athing comtr' id='40787412'>
  <td><table><tr><td class="default"><div class="comment"><div class="commtext c00">
    Discussed before: <a href="item?id=40728988">https://news.ycombinator.com/item?id=40728988</a>
  </div></div></td></tr></table></td>
</tr>
</table></td></tr>
</table></center></body></html>
`

/** A subreddit listing on `reddit.com`: two link posts and one self post. */
export const redditListing = `<html><body><shreddit-app>
<shreddit-feed>
<article class="w-full m-0"><shreddit-post
    class="block relative cursor-pointer"
    id="t3_1dnr4kx"
    permalink="/r/science/comments/1dnr4kx/not_all_open_source_ai_models_are_open/"
    content-href="https://www.nature.com/articles/d41586-024-02012-5"
    comment-count="213"
    score="4821"
    author="somebody"
    created-timestamp="2024-06-25T09:17:08.000Z"
    subreddit-prefixed-name="r/science"
    post-title="Not all 'open source' AI models are open: here's a ranking">
  <a slot="full-post-link" href="/r/science/comments/1dnr4kx/not_all_open_source_ai_models_are_open/">link</a>
</shreddit-post></article>

<article class="w-full m-0"><shreddit-post
    id="t3_1dpz9qa"
    permalink="/r/MachineLearning/comments/1dpz9qa/not_all_open_source_ai_models_are_open/"
    content-href="https://out.reddit.com/?url=https%3A%2F%2Fexample.com%2Fwrapped-article&amp;token=abc"
    comment-count="41"
    score="312"
    author="researcher"
    created-timestamp="2024-06-27T08:00:00.000Z"
    post-title="Not all open source AI models are open">
</shreddit-post></article>

<article class="w-full m-0"><shreddit-post
    id="t3_1dq00zz"
    permalink="/r/AskReddit/comments/1dq00zz/what_are_you_reading/"
    content-href="https://www.reddit.com/r/AskReddit/comments/1dq00zz/what_are_you_reading/"
    comment-count="1904"
    score="9"
    author="curious"
    created-timestamp="2024-06-27T10:00:00.000Z"
    post-title="What are you reading?">
</shreddit-post></article>
</shreddit-feed>
</shreddit-app></body></html>
`

/** The same subreddit as `old.reddit.com` renders it. */
export const redditOldListing = `<html><body><div id="siteTable" class="sitetable linklisting">
<div class=" thing id-t3_1dnr4kx odd link " data-fullname="t3_1dnr4kx"
     data-url="https://www.nature.com/articles/d41586-024-02012-5"
     data-permalink="/r/science/comments/1dnr4kx/not_all_open_source_ai_models_are_open/"
     data-score="4821" data-comments-count="213" data-author="somebody" data-timestamp="1719307028000">
  <div class="entry unvoted"><p class="title">
    <a class="title may-blank " href="https://www.nature.com/articles/d41586-024-02012-5">Not all &#39;open source&#39; AI models are open</a>
  </p></div>
</div>
<div class=" thing id-t3_1dq00zz even self " data-fullname="t3_1dq00zz"
     data-url="/r/AskReddit/comments/1dq00zz/what_are_you_reading/"
     data-score="9" data-comments-count="1904" data-author="curious" data-timestamp="1719480000000">
  <div class="entry unvoted"><p class="title">
    <a class="title may-blank " href="/r/AskReddit/comments/1dq00zz/what_are_you_reading/">What are you reading?</a>
  </p></div>
</div>
</div></body></html>
`

/** One Reddit thread: the post, and two comments carrying outside addresses. */
export const redditCommentPage = `<html><body><shreddit-app>
<shreddit-post
    id="t3_1dnr4kx"
    permalink="/r/science/comments/1dnr4kx/not_all_open_source_ai_models_are_open/"
    content-href="https://www.nature.com/articles/d41586-024-02012-5"
    comment-count="214"
    score="4890"
    author="somebody"
    created-timestamp="2024-06-25T09:17:08.000Z"
    post-title="Not all 'open source' AI models are open: here's a ranking">
</shreddit-post>

<shreddit-comment-tree>
<shreddit-comment thingid="t1_l5abcde" author="reader" score="88" depth="0">
  <div slot="comment"><div class="md"><p>The preprint is
    <a href="https://arxiv.org/abs/2402.00001" rel="nofollow">here</a> and the data is
    <a href="https://example.org/data.csv" rel="nofollow">here</a>.</p></div></div>
</shreddit-comment>
<shreddit-comment thingid="t1_l5xyzzy" author="other" score="4" depth="1">
  <div slot="comment"><div class="md"><p>See also
    <a href="https://www.reddit.com/r/MachineLearning/comments/1dpz9qa/">this thread</a>.</p></div></div>
</shreddit-comment>
</shreddit-comment-tree>
</shreddit-app></body></html>
`

/** A timeline: two posts carrying `t.co` links, and one carrying none. */
export const xTimeline = `<html><body><div aria-label="Timeline: Your Home Timeline">
<article data-testid="tweet" role="article" tabindex="0">
  <div data-testid="User-Name"><a href="/nature"><span>Nature</span></a>
    <a href="/nature/status/1805123456789012345"><time datetime="2024-06-25T09:17:08.000Z">Jun 25</time></a>
  </div>
  <div data-testid="tweetText"><span>Not all open source AI models are open.</span> <a href="https://t.co/x7Kd2Ab" dir="ltr"><span>nature.com/articles/d4158…</span></a></div>
  <a href="https://t.co/x7Kd2Ab" role="link" data-testid="card.wrapper"><span>nature.com</span></a>
  <div role="group">
    <div data-testid="reply"><span data-testid="app-text-transition-container"><span>18</span></span></div>
    <div data-testid="retweet"><span><span>44</span></span></div>
    <div data-testid="like"><span data-testid="app-text-transition-container"><span>1.2K</span></span></div>
  </div>
</article>

<article data-testid="tweet" role="article" tabindex="0">
  <div data-testid="User-Name"><a href="/someone"><span>Someone</span></a>
    <a href="/someone/status/1805999999999999999"><time datetime="2024-06-26T11:00:00.000Z">Jun 26</time></a>
  </div>
  <div data-testid="tweetText"><span>No link here, just an opinion.</span></div>
  <div role="group">
    <div data-testid="reply"><span data-testid="app-text-transition-container"><span>2</span></span></div>
    <div data-testid="like"><span data-testid="app-text-transition-container"><span>9</span></span></div>
  </div>
</article>

<article data-testid="tweet" role="article" tabindex="0">
  <div data-testid="User-Name"><a href="/reader"><span>Reader</span></a>
    <a href="/reader/status/1806111111111111111"><time datetime="2024-06-27T07:30:00.000Z">Jun 27</time></a>
  </div>
  <div data-testid="tweetText"><span>Good piece:</span> <a href="https://t.co/Zq9Lm3P" dir="ltr"><span>example.com/a-second-story</span></a></div>
  <div role="group">
    <div data-testid="reply"><span data-testid="app-text-transition-container"><span>0</span></span></div>
    <div data-testid="like"><span data-testid="app-text-transition-container"><span>3</span></span></div>
  </div>
</article>
</div></body></html>
`

/**
 * What a reskin looks like: a real page, rendered, carrying none of the
 * structure any parser is anchored on.
 *
 * This is the input that must produce nothing AND say so. A parser that returns
 * an empty list here is indistinguishable from one reading a genuinely empty
 * page, which is why {@link ./Page.ts}'s `Legibility` exists.
 */
export const reskinned = `<html><body><div id="root">
  <main><section class="feed-v2">
    <div class="card"><h2>Not all open source AI models are open</h2>
      <a class="card-target" href="https://www.nature.com/articles/d41586-024-02012-5">read</a>
    </div>
  </section></main>
</div></body></html>
`
