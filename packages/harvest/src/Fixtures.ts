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
 * `article[data-testid="tweet"]`.
 *
 * The three added on 2026-08-24 differ in provenance and it is worth knowing
 * which is which. **Lobsters** and **Lemmy** are condensed from markup actually
 * fetched that day (`lobste.rs/`, one story page; `lemmy.ml/`, one post page —
 * `lemmy.world` sits behind a Cloudflare challenge that answers a plain fetch
 * with an interstitial, and runs the same `lemmy-ui`). **Bluesky** is
 * reconstructed from the app's `data-testid` conventions and could not be
 * otherwise: `bsky.app` builds its DOM in the browser, so there is nothing to
 * fetch. Treat them as a specification of what the
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

/**
 * A Lobsters front page: two stories with outbound addresses, one text story.
 *
 * Condensed from `https://lobste.rs/` as served on 2026-08-24. Two structures
 * are kept verbatim because they are the tests rather than the scenery: the
 * `<details class="caches">` block, whose `web.archive.org` and
 * `ghostarchive.org` anchors a sweeping parser would harvest as Mentions; and
 * the multi-line `class="story\n\n"` attribute Lobsters really emits.
 */
export const lobstersListing = `<html><body><div id="inside"><ol class="stories list ">
<li id="story_8ttu5n" data-shortid="8ttu5n"
class="story



">
<div class="story_liner h-entry">
  <div class="voters"><a class="upvoter" href="/login">148</a></div>
  <div class="details">
    <span role="heading" aria-level="1" class="link h-cite u-repost-of">
      <a class="u-url" href="https://fzakaria.com/2026/08/23/your-executable-is-a-sqlite-database" rel="ugc noreferrer">Your executable is a SQLite database</a>
    </span>
    <ul class="tags" aria-label="Tags"><li><a class="tag tag_databases" href="/t/databases">databases</a></li></ul>
    <a class="domain" href="/domains/fzakaria.com">fzakaria.com</a>
    <div class="byline">
      <a tabindex="-1" aria-hidden="true" href="/~jummo"><img class="avatar" alt="" src="/avatars/jummo-16.png"></a>
      <span> via </span><a href="/~jummo">jummo</a>
      <time title="2026-08-24 02:32:45" datetime="2026-08-24 02:32:45" data-at-unix="1787556765">2026-08-24 02:32:45</time>
      <span aria-hidden="true"> | </span>
      <details class="caches" name="caches"><summary>caches</summary><ul>
        <li><a href="https://web.archive.org/web/3/https%3A%2F%2Ffzakaria.com%2F2026%2F08%2F23%2Fyour-executable-is-a-sqlite-database">Archive.org</a></li>
        <li><a href="https://ghostarchive.org/search?term=https%3A%2F%2Ffzakaria.com%2F">Ghostarchive</a></li>
      </ul></details>
      <span class="comments_label"><span aria-hidden="true"> | </span>
        <a role="heading" aria-level="2" href="/s/8ttu5n/your_executable_is_sqlite_database">13 comments</a>
      </span>
    </div>
  </div>
</div>
<a href="/s/8ttu5n/your_executable_is_sqlite_database" class="mobile_comments "><span>13</span></a>
</li>

<li id="story_rehaa3" data-shortid="rehaa3" class="story ">
<div class="story_liner h-entry">
  <div class="voters"><a class="upvoter" href="/login">67</a></div>
  <div class="details">
    <span role="heading" aria-level="1" class="link h-cite u-repost-of">
      <a class="u-url" href="https://example.com/emacs-30-released?utm_source=lobsters" rel="ugc noreferrer">Emacs 30 released</a>
    </span>
    <a class="domain" href="/domains/example.com">example.com</a>
    <div class="byline">
      <a href="/~someone">someone</a>
      <time datetime="2026-08-23 21:00:00" data-at-unix="1787518800">2026-08-23 21:00:00</time>
      <span class="comments_label"><span aria-hidden="true"> | </span>
        <a href="/s/rehaa3/emacs_30_released">no comments</a>
      </span>
    </div>
  </div>
</div>
</li>

<li id="story_0typpq" data-shortid="0typpq" class="story ">
<div class="story_liner h-entry">
  <div class="voters"><a class="upvoter" href="/login">71</a></div>
  <div class="details">
    <span role="heading" aria-level="1" class="link h-cite u-repost-of">
      <a class="u-url" href="/s/0typpq/i_cannot_survive_from_burnout" rel="ugc noreferrer">I cannot survive from burnout</a>
    </span>
    <div class="byline">
      <span> authored by </span><a class="user_is_author" href="/~delirehberi">delirehberi</a>
      <time datetime="2026-08-24 11:04:45" data-at-unix="1787587485">2026-08-24 11:04:45</time>
      <span class="comments_label"><span aria-hidden="true"> | </span>
        <a href="/s/0typpq/i_cannot_survive_from_burnout">20 comments</a>
      </span>
    </div>
  </div>
</div>
</li>
</ol></div></body></html>
`

/** One Lobsters story: the submission, and two comments carrying addresses. */
export const lobstersStory = `<html><body><div id="inside"><ol class="stories">
<li id="story_8ttu5n" data-shortid="8ttu5n" class="story">
<div class="story_liner h-entry">
  <div class="voters"><a class="upvoter" href="/login">151</a></div>
  <div class="details" id="header_story_01m0saz7fnfntvegtz8m1cexx1">
    <span role="heading" aria-level="1" class="link h-cite u-repost-of">
      <a href="https://fzakaria.com/2026/08/23/your-executable-is-a-sqlite-database" rel="ugc noreferrer" class="u-url">Your executable is a SQLite database</a>
    </span>
    <a class="domain" href="/domains/fzakaria.com">fzakaria.com</a>
    <div class="byline"><span>via</span><a href="/~jummo">jummo</a>
      <time datetime="2026-08-24 02:32:45" data-at-unix="1787556765">2026-08-24 02:32:45</time>
      <span aria-hidden="true"> | </span>
      <details class="caches" name="caches"><ul>
        <li><a href="https://web.archive.org/web/3/https%3A%2F%2Ffzakaria.com%2F">Archive.org</a></li>
      </ul></details>
      <span class="comments_label"><span aria-hidden="true"> | </span>
        <a role="heading" aria-level="2" href="#comments-8ttu5n">14 comments</a>
      </span>
    </div>
  </div>
</div>
</li>
</ol>
<div class="story_content"></div>
<ol class="comments comments1">
  <li class="comments_subtree">
    <div class="comment_form_container" data-shortid="">
      <form action="/comments" method="post"><textarea name="comment"></textarea></form>
    </div>
  </li>
  <li class="comments_subtree" id="comments-8ttu5n"><ol class="comments" id="story_comments">
    <li class="comments_subtree">
      <div id="c_bqdtco" data-shortid="bqdtco" class="comment">
        <div class="voters"><a class="upvoter" title="18" href="/login">18</a></div>
        <div class="details"><div class="byline">
          <a class="new_user" href="/~pjjw">pjjw</a>
          <a href="/c/bqdtco"><time data-at-unix="1787565031">2026-08-24 04:50:31</time></a>
        </div>
        <div role="heading" aria-level="3" class="comment_text">
          <p>The write-up is at <a href="https://sqlite.org/appfileformat.html" rel="ugc">sqlite.org</a>
          and there is a follow-up at <a href="https://example.org/notes.pdf" rel="ugc">example.org/notes.pdf</a>.</p>
        </div></div>
      </div>
    </li>
    <li class="comments_subtree">
      <div id="c_zzq14m" data-shortid="zzq14m" class="comment">
        <div class="voters"><a class="upvoter" title="3" href="/login">3</a></div>
        <div class="details"><div class="byline"><a href="/~other">other</a></div>
        <div role="heading" aria-level="3" class="comment_text">
          <p>Discussed before: <a href="https://lobste.rs/s/aaaaaa/older_thread">older thread</a>.</p>
        </div></div>
      </div>
    </li>
  </ol></li>
</ol></div></body></html>
`

/**
 * A Lemmy instance front page: two posts, one of them federated, one a text
 * post with no address of its own.
 *
 * Condensed from `https://lemmy.ml/` as served on 2026-08-24, keeping the two
 * structures that decide the parse: lemmy-ui renders each post TWICE — a
 * narrow-screen copy and a wide-screen one, and only the wide copy carries
 * `div.post-score` — and the fedilink anchor, whose href is the ap_id and which
 * on a federated post points at another instance entirely.
 */
export const lemmyListing = `<html><body><main><div class="post-listings">
<div class="post-listing mt-2">
  <div class="d-block d-sm-none"><article class="row post-container"><div class="col-12">
    <div class="small mb-1 mb-md-0">
      <a class="person-listing d-inline-flex align-items-baseline text-info" title="tumbling4986" href="/u/Crumpled6273@lemmy.ca"><span>tumbling4986</span><small class="text-muted">@lemmy.ca</small></a>
      to <a class="community-link " title="Privacy" href="/c/privacy"><span>Privacy</span></a>
      <span class="moment-time pointer unselectable" data-tippy-content="Sunday, August 23rd, 2026 at 1:55:21 PM GMT+00:00">1 day ago</span>
    </div>
    <div class="post-title"><h1 class="h5 d-inline text-break"><a class="d-inline link-dark" title="Comments" href="/post/51762294"><span class="d-inline">Effective Web Tracking Methods in 2026: Explained</span></a></h1></div>
    <p class="small m-0"><a class="fst-italic link-dark" href="https://minddump-5f4.pages.dev/posts/online-tracking-methods/" rel="noopener nofollow">minddump-5f4.pages.dev</a></p>
    <a class="thumbnail rounded overflow-hidden" href="https://minddump-5f4.pages.dev/posts/online-tracking-methods/" rel="noopener nofollow" target="_self"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-external-link"></use></svg></a>
    <div class="d-flex align-items-center">
      <a class="btn btn-link btn-sm text-muted ps-0" title="24 Comments" href="/post/51762294?scrollToComments=true"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-message-square"></use></svg>24</a>
      <a class="btn btn-link btn-animate text-muted" title="link" href="/post/51762294"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-link"></use></svg></a>
      <a class="btn btn-sm btn-link btn-animate text-muted py-0" title="link" href="https://lemmy.ca/post/69795063"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-fedilink"></use></svg></a>
    </div>
  </div></article></div>
  <div class="d-none d-sm-block"><article class="row post-container">
    <div class="col flex-grow-0"><div class="vote-bar small text-center">
      <button type="button" data-tippy-content="91 Upvotes · 0 Downvotes" aria-label="Upvote"></button>
      <div class="unselectable pointer text-muted post-score" data-tippy-content="91 Upvotes · 0 Downvotes">91</div>
    </div></div>
  </article></div>
</div>

<div class="post-listing mt-2">
  <div class="d-block d-sm-none"><article class="row post-container"><div class="col-12">
    <div class="small"><a class="person-listing" href="/u/reader">reader</a>
      to <a class="community-link " title="Technology" href="/c/technology@lemmy.world"><span>Technology</span></a></div>
    <div class="post-title"><h1 class="h5 d-inline text-break"><a class="d-inline link-dark" title="Comments" href="/post/51770001"><span class="d-inline">A second story</span></a></h1></div>
    <p class="small m-0"><a class="fst-italic link-dark" href="https://example.com/a-second-story?utm_source=lemmy" rel="noopener nofollow">example.com</a></p>
    <div class="d-flex align-items-center">
      <a class="btn btn-link btn-sm text-muted ps-0" title="3 Comments" href="/post/51770001?scrollToComments=true">3</a>
      <a class="btn btn-sm btn-link btn-animate text-muted py-0" title="link" href="https://lemmy.ml/post/51770001"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-fedilink"></use></svg></a>
    </div>
  </div></article></div>
  <div class="d-none d-sm-block"><article class="row post-container">
    <div class="unselectable pointer text-muted post-score" data-tippy-content="12 Upvotes · 0 Downvotes">12</div>
  </article></div>
</div>

<div class="post-listing mt-2">
  <div class="d-block d-sm-none"><article class="row post-container"><div class="col-12">
    <div class="post-title"><h1 class="h5 d-inline text-break"><a class="d-inline link-dark" title="Comments" href="/post/51780002"><span class="d-inline">What are you reading?</span></a></h1></div>
    <div class="d-flex align-items-center">
      <a class="btn btn-link btn-sm text-muted ps-0" title="1904 Comments" href="/post/51780002?scrollToComments=true">1904</a>
      <a class="btn btn-sm btn-link btn-animate text-muted py-0" title="link" href="https://lemmy.ml/post/51780002"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-fedilink"></use></svg></a>
    </div>
  </div></article></div>
  <div class="d-none d-sm-block"><article class="row post-container">
    <div class="unselectable pointer text-muted post-score" data-tippy-content="9 Upvotes · 0 Downvotes">9</div>
  </article></div>
</div>
</div>
<footer><a href="https://join-lemmy.org">Lemmy</a> · <a href="https://github.com/LemmyNet/lemmy">code</a></footer>
</main></body></html>
`

/** One federated Lemmy post, viewed on an instance that is not its home. */
export const lemmyPost = `<html><body><main><div class="post container-lg">
<div class="post-listing mt-2">
  <div class="d-block d-sm-none"><article class="row post-container"><div class="col-12">
    <div class="small mb-1 mb-md-0">
      <a class="person-listing d-inline-flex align-items-baseline text-info" title="tumbling4986" href="/u/Crumpled6273@lemmy.ca"><span>tumbling4986</span><small class="text-muted">@lemmy.ca</small></a>
      to <a class="community-link " title="Privacy" href="/c/privacy"><span>Privacy</span></a>
      <span class="moment-time" data-tippy-content="Sunday, August 23rd, 2026 at 1:55:21 PM GMT+00:00">1 day ago</span>
    </div>
    <div class="post-title"><h1 class="h5 d-inline text-break"><a class="link-dark" href="https://minddump-5f4.pages.dev/posts/online-tracking-methods/" rel="noopener nofollow">Effective Web Tracking Methods in 2026: Explained</a></h1></div>
    <p class="small m-0"><a class="fst-italic link-dark" href="https://minddump-5f4.pages.dev/posts/online-tracking-methods/" rel="noopener nofollow">minddump-5f4.pages.dev</a></p>
    <div class="d-flex align-items-center">
      <a class="btn btn-link btn-sm text-muted ps-0" title="26 Comments" href="/post/51762294?scrollToComments=true">26</a>
      <a class="btn btn-link btn-animate text-muted" title="link" href="/post/51762294"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-link"></use></svg></a>
      <a class="btn btn-sm btn-link btn-animate text-muted py-0" title="link" href="https://lemmy.ca/post/69795063"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-fedilink"></use></svg></a>
    </div>
  </div></article></div>
  <div class="d-none d-sm-block"><article class="row post-container">
    <div class="unselectable pointer text-muted post-score" data-tippy-content="94 Upvotes · 0 Downvotes">94</div>
  </article></div>
</div>

<ul class="comments border-top border-light">
<li class="comment list-unstyled"><article class="details comment-node py-2" id="comment-27405556">
  <div class="ms-2"><div class="d-flex flex-wrap align-items-center text-muted small">
    <a class="person-listing" title="asbestos" href="/u/asbestos@lemmy.world"><span>asbestos</span></a>
    <a class="btn btn-link btn-sm" title="link" href="/post/51762294/27405556"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-link"></use></svg></a>
    <a class="btn btn-link btn-sm" title="link" href="https://lemmy.world/comment/25444765"><svg class="icon"><use xlink:href="/static/assets/symbols.svg#icon-fedilink"></use></svg></a>
  </div>
  <div class="comment-content"><div class="md-div"><p dir="auto">Great writeup — the measurements are at
    <a href="https://arxiv.org/abs/2402.00001" rel="nofollow">arxiv.org</a> and the raw data at
    <a href="https://example.org/data.csv" rel="nofollow">example.org/data.csv</a>.</p></div></div>
  </div>
</article></li>
<li class="comment list-unstyled"><article class="details comment-node py-2" id="comment-27405709">
  <div class="ms-2">
  <div class="comment-content"><div class="md-div"><p dir="auto">Also on
    <a href="https://lemmy.world/post/12345" rel="nofollow">lemmy.world</a>.</p></div></div>
  </div>
</article></li>
</ul>
</div></main></body></html>
`

/**
 * A Bluesky feed: one post with an external card, one with no link, and one
 * whose permalink names a did rather than a handle.
 *
 * Reconstructed from `bsky.app`'s `data-testid` conventions as of 2026-08-24 —
 * this one cannot be captured with a fetch, because the page is built in the
 * browser. It is the specification of what the parser accepts, and the third
 * post exists to prove both halves of the identity decision documented in
 * {@link ./Bluesky.ts}: a handle in the did slot, and a did when there is one.
 */
export const blueskyFeed = `<html><body><div data-testid="homeScreenFeedTabs">
<div data-testid="feedItem-by-nature.com" role="link">
  <a href="/profile/nature.com"><span>Nature</span></a>
  <a href="/profile/nature.com/post/3kv2xqz7abc22"><time datetime="2026-08-25T09:17:08.000Z">2h</time></a>
  <div data-testid="postText"><span>Not all open source AI models are open.</span>
    <a href="https://www.nature.com/articles/d41586-024-02012-5">nature.com/articles/d4158...</a></div>
  <a href="https://www.nature.com/articles/d41586-024-02012-5" data-testid="externalLinkCard"><span>nature.com</span></a>
  <div role="button" data-testid="replyBtn" aria-label="Reply (18 replies)"><span data-testid="replyCount">18</span></div>
  <div role="button" data-testid="likeBtn" aria-label="Like (1.2K likes)"><span data-testid="likeCount">1.2K</span></div>
</div>

<div data-testid="feedItem-by-someone.bsky.social" role="link">
  <a href="/profile/someone.bsky.social/post/3kv2yy00def"><time datetime="2026-08-25T11:00:00.000Z">1h</time></a>
  <div data-testid="postText"><span>No link here, just an opinion.</span></div>
  <div role="button" data-testid="replyBtn" aria-label="Reply (2 replies)"><span data-testid="replyCount">2</span></div>
  <div role="button" data-testid="likeBtn" aria-label="Like (9 likes)"><span data-testid="likeCount">9</span></div>
</div>

<div data-testid="feedItem-by-reader.example" role="link">
  <a href="/profile/did:plc:z72i7hdynmk6r22z27h6tvur/post/3kv2zzz11ghi"><time datetime="2026-08-25T12:30:00.000Z">30m</time></a>
  <div data-testid="postText"><span>Good piece:</span>
    <a href="https://example.com/a-second-story?utm_source=bsky">example.com/a-second-story</a></div>
  <div role="button" data-testid="replyBtn" aria-label="Reply"></div>
  <div role="button" data-testid="likeBtn" aria-label="Like (3 likes)"><span data-testid="likeCount">3</span></div>
</div>
</div></body></html>
`

/** One Bluesky thread: the root post, and two replies carrying addresses. */
export const blueskyThread = `<html><body><div data-testid="postThreadScreen">
<div data-testid="postThreadItem-by-nature.com">
  <a href="/profile/nature.com/post/3kv2xqz7abc22"><time datetime="2026-08-25T09:17:08.000Z">2h</time></a>
  <div data-testid="postText"><span>Not all open source AI models are open.</span>
    <a href="https://www.nature.com/articles/d41586-024-02012-5">nature.com/articles/d4158...</a></div>
  <div role="button" data-testid="replyBtn" aria-label="Reply (19 replies)"><span data-testid="replyCount">19</span></div>
  <div role="button" data-testid="likeBtn" aria-label="Like (1.3K likes)"><span data-testid="likeCount">1.3K</span></div>
</div>

<div data-testid="postThreadItem-by-someone.bsky.social">
  <a href="/profile/someone.bsky.social/post/3kv3aaa22jkl"><time datetime="2026-08-25T10:00:00.000Z">1h</time></a>
  <div data-testid="postText"><span>The methodology is here:</span>
    <a href="https://opening-up-chatgpt.github.io/">opening-up-chatgpt.github.io</a></div>
  <div role="button" data-testid="likeBtn" aria-label="Like (4 likes)"><span data-testid="likeCount">4</span></div>
</div>

<div data-testid="postThreadItem-by-other.example">
  <a href="/profile/other.example/post/3kv3bbb33mno"><time datetime="2026-08-25T10:20:00.000Z">40m</time></a>
  <div data-testid="postText"><span>Discussed before:</span>
    <a href="https://bsky.app/profile/nature.com/post/3kv0000aaaaa">an earlier thread</a></div>
</div>
</div></body></html>
`
