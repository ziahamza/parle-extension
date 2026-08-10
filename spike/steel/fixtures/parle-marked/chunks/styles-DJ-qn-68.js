import{f as d}from"./Panel-NYtfPEYe.js";const w=e=>{try{const a=new URL(e);return a.protocol!=="http:"&&a.protocol!=="https:"?null:a.hostname.replace(/^www\./,"")}catch{return null}},x=e=>e.length<=1?e[0]??"Nowhere":`${e.slice(0,-1).join(", ")} and ${e[e.length-1]}`,t=(e,a,r)=>{const l=document.createElement(e);return a!==""&&(l.className=a),r!==void 0&&(l.textContent=r),l},p=(e,a,r)=>{const l=t("button",e,a);return l.addEventListener("click",o=>{o.preventDefault(),r()}),l},k=e=>e===1?"also submitted once":`also submitted ${e} times`,u=(e,a)=>{const r=t("a","parle-row");r.href=e.permalink,r.target="_blank",r.rel="noreferrer noopener",r.addEventListener("click",o=>{o.preventDefault(),a.openOut(e.permalink)}),r.appendChild(t("span","parle-title",e.title));const l=t("div","parle-facts");return l.appendChild(t("span","parle-network",e.networkName)),l.appendChild(t("span","",`${e.score} points`)),l.appendChild(t("span","",`${e.commentCount} ${e.commentCount===1?"comment":"comments"}`)),e.age!==""&&l.appendChild(t("span","",e.age)),e.alsoSubmitted>0&&l.appendChild(t("span","parle-repeat",k(e.alsoSubmitted))),r.appendChild(l),r},c=(e,a,r,l,o)=>{if(l.length===0)return null;const n=t("section",`parle-group parle-group-${e}`),i=t("h2","parle-group-name",`${a} `);i.appendChild(t("span","parle-group-note",r)),n.appendChild(i);for(const s of l)n.appendChild(u(s,o));return n},h=(e,a)=>{const r=t("section","parle-folded");r.appendChild(t("p","parle-folded-says",e.says));const l=t("div","parle-folded-rows");l.hidden=!0;for(const n of e.rows)l.appendChild(u(n,a));const o=p("parle-act parle-act-folded",e.label,()=>{l.hidden=!1,o.remove()});return r.appendChild(o),r.appendChild(l),r},y=(e,a)=>{const r=t("a","parle-source");return r.href=e.permalink,r.target="_blank",r.rel="noreferrer noopener",r.addEventListener("click",l=>{l.preventDefault(),a.openOut(e.permalink)}),r.appendChild(t("span","parle-source-label",e.comment?`${e.label} \u2014 the comment`:e.label)),r},C=(e,a)=>{const r=t("div",e.contested?"parle-finding parle-finding-disputed":"parle-finding");e.contested&&r.appendChild(t("span","parle-disputed","Someone there disagreed")),r.appendChild(t("p","parle-finding-says",e.statement));const l=t("div","parle-sources");for(const o of e.sources)l.appendChild(y(o,a));return r.appendChild(l),r},z=(e,a)=>{if(e.says.text===""&&e.findings.length===0&&e.offer===null)return null;const r=t("section",`parle-digest parle-tone-${e.says.tone}`);e.says.text!==""&&r.appendChild(t("h2","parle-digest-title",e.says.text));for(const o of e.findings)r.appendChild(C(o,a));e.partial&&r.appendChild(t("p","parle-digest-partial","This is part of an answer \u2014 some of it could not be traced to a comment."));const l=e.offer;return l!==null&&(l.says!==""&&r.appendChild(t("p","parle-digest-says",l.says)),r.appendChild(p("parle-act parle-act-digest",l.label,l.kind==="connect"?a.openSettings:a.summarise))),e.wrote!==null&&r.appendChild(t("p","parle-digest-wrote",e.wrote)),r},g=e=>e.waitingOn.length===0?"Still looking.":`Still looking \u2014 ${e.waitingOn.join(", ")}`,v=e=>{const a=d(e);return a>0?`${a} discussion${a===1?"":"s"} on this page.`:e.stillLooking?g(e):e.folded!==null?e.folded.says:e.foundNothing?`Nobody has discussed this page. ${x(e.answeredBy)} answered, with nothing.`:e.couldNotAsk?"Parle could not find out. Nowhere answered \u2014 which is not the same as nobody discussing it.":"Nothing has been asked about this page yet."},N=(e,a)=>{switch(e.kind){case"not-a-web-page":return null;case"undecided":return p("parle-act parle-act-strong","Read this and choose",a.openDisclosure);case"automatic-off":return p("parle-act","Look this page up",a.lookAnyway);case"networks-off":return p("parle-act","Choose where Parle looks",a.openSettings);case"excluded":case"site-paused":case"over-budget":case"switched-off":case"front-door":return p("parle-act","Look it up anyway",a.lookAnyway)}},$=(e,a)=>{const r=t("div",`parle-restraint parle-restraint-${e.kind}`);r.appendChild(t("p","parle-restraint-says",e.says));const l=N(e,a);return l!==null&&r.appendChild(l),r},f=(e,a)=>t("div",`${a} parle-tone-${e.tone}`,e.text),S=e=>{const a=t("section","parle-coverage");a.appendChild(t("h2","parle-coverage-name","Where Parle asked"));for(const r of e){const l=t("div","parle-account");l.appendChild(t("span","parle-account-place",r.place)),l.appendChild(t("span",`parle-account-${r.tone}`,r.standing)),a.appendChild(l)}return a},m=(e,a)=>{const r=w(e.address);if(r===null)return null;const l=e.restraint!==null&&e.restraint.kind==="site-paused";return p("parle-link",l?`Resume on ${r}`:`Pause on ${r}`,()=>l?a.resumeSite(r):a.pauseSite(r))},L=(e,a)=>{const r=t("footer","parle-footer"),l=t("div","parle-footer-row"),o=m(e,a);return o!==null&&l.appendChild(o),l.appendChild(p("parle-link","Settings",a.openSettings)),r.appendChild(l),r},O=(e,a)=>{const r=t("footer","parle-footer"),l=t("div","parle-footer-row");l.appendChild(t("span","parle-footer-state",e.automatic?"Looking pages up automatically":"Only when you ask")),l.appendChild(p("parle-link",e.automatic?"Turn off":"Turn on",()=>a.decide(!e.automatic))),r.appendChild(l);const o=t("div","parle-footer-row"),n=m(e,a);return n!==null&&o.appendChild(n),o.appendChild(p("parle-link","What Parle sends",a.openDisclosure)),o.appendChild(p("parle-link","Settings",a.openSettings)),r.appendChild(o),r},b=e=>{const a=t("header","parle-head");return a.appendChild(t("h1","parle-heading",e.heading)),a.appendChild(t("div","parle-address",e.address)),a},A=(e,a,r)=>{e.textContent="",e.className="parle",e.appendChild(b(a));const l=t("div","parle-body"),o=[c("linked","About this page","their own link points here",a.linked,r),c("passing","Came up elsewhere","linked inside a conversation about something else",a.passing,r),c("topical","On this topic","matched by title \u2014 not provably this page",a.topical,r)];for(const i of o)i!==null&&l.appendChild(i);if(a.folded!==null&&l.appendChild(h(a.folded,r)),a.windowed!==null&&l.appendChild(f(a.windowed,"parle-note")),d(a)===0&&a.folded===null)l.appendChild(t("p","parle-said",a.restraint===null?v(a):a.restraint.says));else if(a.stillLooking){const i=t("div","parle-notice parle-tone-waiting"),s=t("span","");s.appendChild(t("span","parle-spinner")),s.appendChild(document.createTextNode(g(a))),i.appendChild(s),l.appendChild(i)}const n=z(a.digest,r);n!==null&&l.appendChild(n),e.appendChild(l),e.appendChild(L(a,r))},D=(e,a,r)=>{e.textContent="",e.className="parle",e.appendChild(b(a));const l=t("div","parle-body");a.restraint!==null&&l.appendChild($(a.restraint,r));const o=a.folded!==null&&d(a)===0;(a.restraint===null||d(a)>0)&&!o&&l.appendChild(t("p","parle-said",v(a))),a.folded!==null&&l.appendChild(h(a.folded,r)),a.accounts.length>0&&l.appendChild(S(a.accounts)),a.windowed!==null&&l.appendChild(f(a.windowed,"parle-note")),a.index!==null&&l.appendChild(f(a.index,"parle-note")),e.appendChild(l),(a.restraint===null||a.restraint.kind!=="undecided")&&e.appendChild(O(a,r))},E=(e,a,r)=>{if(d(a)===0){D(e,a,r);return}A(e,a,r)},R=`
:host,
.parle, .parle-pill, .parle-dock {
  --parle-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --parle-t-meta: 11px;
  --parle-t-body: 13px;
  --parle-t-lead: 15px;
  --parle-t-head: 18px;
  --parle-1: 4px;
  --parle-2: 8px;
  --parle-3: 12px;
  --parle-4: 16px;
  --parle-5: 24px;
  --parle-r: 10px;
  --parle-r-sm: 6px;
  --parle-r-full: 999px;
  --parle-bg: #ffffff;
  --parle-raise: #f4f5f7;
  --parle-ink: #14161a;
  --parle-mid: #5b6270;
  --parle-faint: #6f7683;
  --parle-line: rgba(20, 22, 26, 0.1);
  --parle-rule: rgba(20, 22, 26, 0.2);
  --parle-accent: #0d7a52;
  --parle-on-accent: #ffffff;
  --parle-warn: #7a5200;
  --parle-stop: #99291c;
  --parle-lift: 0 1px 2px rgba(10, 12, 16, 0.06), 0 10px 32px rgba(10, 12, 16, 0.14);
  --parle-motion: cubic-bezier(0.2, 0.75, 0.3, 1);
}
@media (prefers-color-scheme: dark) {
  :host,
  .parle, .parle-pill, .parle-dock {
    --parle-bg: #101216;
    --parle-raise: #191c22;
    --parle-ink: #e8eaef;
    --parle-mid: #a2a9b6;
    --parle-faint: #8b929f;
    --parle-line: rgba(232, 234, 239, 0.11);
    --parle-rule: rgba(232, 234, 239, 0.24);
    --parle-accent: #57d39b;
    --parle-on-accent: #0a1a12;
    --parle-warn: #e0bd76;
    --parle-stop: #f0a396;
    --parle-lift: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 32px rgba(0, 0, 0, 0.5);
  }
}

/* the phone scale */
@media (max-width: 639px) {
  :host,
  .parle, .parle-pill, .parle-dock {
    --parle-t-meta: 12px;
    --parle-t-body: 15px;
    --parle-t-lead: 17px;
  }
}

/* reset \u2014 nothing inherits from the page this is drawn on */
.parle, .parle-pill, .parle-dock {
  all: initial;
  color-scheme: light dark;
  font-family: var(--parle-font);
  font-size: var(--parle-t-body);
  line-height: 1.5;
  color: var(--parle-ink);
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}
.parle *, .parle *::before, .parle *::after,
.parle-pill *, .parle-pill::before, .parle-pill::after,
.parle-dock * { box-sizing: border-box; }
.parle a { color: inherit; text-decoration: none; }
.parle :focus-visible,
.parle-pill:focus-visible, .parle-close:focus-visible {
  outline: 2px solid var(--parle-accent);
  outline-offset: 2px;
  border-radius: var(--parle-r-sm);
}

/* the panel */
.parle { display: flex; flex-direction: column; background: var(--parle-bg); }
.parle-head { flex: none; padding: var(--parle-4) var(--parle-4) var(--parle-2); }
.parle-heading {
  margin: 0 0 2px;
  font-size: var(--parle-t-lead);
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parle-address {
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parle-body {
  padding: 0 var(--parle-4) var(--parle-3);
  max-height: 420px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.parle-dock .parle { flex: 1 1 auto; min-height: 0; }
.parle-dock .parle-body { max-height: none; flex: 1 1 auto; min-height: 0; }

/* discussions \u2014 three tiers, three treatments, never blended */
.parle-group { margin: var(--parle-4) 0 0; }
.parle-group:first-child { margin-top: var(--parle-2); }
.parle-group-name {
  margin: 0 0 var(--parle-2);
  font-size: var(--parle-t-meta);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--parle-mid);
}
.parle-group-note {
  display: block;
  margin-top: 2px;
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
.parle-group-linked .parle-group-name { color: var(--parle-accent); }
.parle-row {
  display: block;
  padding: var(--parle-2) var(--parle-3);
  margin: 0 0 var(--parle-1);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
  transition: background 160ms var(--parle-motion);
}
.parle-row:hover { background: var(--parle-line); }
.parle-group-linked .parle-row { box-shadow: inset 2px 0 0 var(--parle-accent); }
.parle-group-passing .parle-row { box-shadow: inset 2px 0 0 var(--parle-rule); }
.parle-group-topical .parle-row { background: transparent; padding-left: var(--parle-2); }
.parle-group-topical .parle-row:hover { background: var(--parle-raise); }
.parle-title { display: block; font-weight: 500; margin-bottom: 2px; }
.parle a:hover .parle-title { text-decoration: underline; }
.parle-facts {
  display: flex;
  gap: var(--parle-2);
  flex-wrap: wrap;
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
}
.parle-network { font-weight: 600; color: var(--parle-mid); }
/* repeat submissions, folded: kept as a fact, never as a row of its own */
.parle-repeat { font-style: italic; }

/* a site's front door: what was set aside, and the one click that opens it.
   Quiet rather than warning-coloured \u2014 nothing has gone wrong here, and the
   product's own rule is that a suppression must read as a decision the reader
   can reverse rather than as an error they have to interpret. */
.parle-folded {
  margin: var(--parle-3) 0 0;
  padding: var(--parle-3);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
}
.parle-folded-says {
  margin: 0 0 var(--parle-2);
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-act-folded { font-size: var(--parle-t-meta); padding: var(--parle-1) var(--parle-3); }
.parle-folded-rows { margin-top: var(--parle-2); }
.parle-folded-rows .parle-row { background: var(--parle-bg); }

/* tones \u2014 six states, six inks, no washes (ADR 0011) */
.parle-tone-refused { color: var(--parle-stop); }
.parle-tone-garbled { color: var(--parle-warn); }
.parle-tone-withheld, .parle-tone-waiting, .parle-tone-quiet { color: var(--parle-mid); }
.parle-tone-found { color: var(--parle-accent); }
.parle-notice {
  display: flex;
  justify-content: space-between;
  gap: var(--parle-2);
  margin: var(--parle-2) 0 0;
  padding: var(--parle-2) var(--parle-3);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
  font-size: var(--parle-t-meta);
}
.parle-said { margin: var(--parle-3) 0; color: var(--parle-mid); }
.parle-restraint { margin: var(--parle-3) 0 var(--parle-4); color: var(--parle-mid); }
.parle-restraint-says { margin: 0 0 var(--parle-3); color: var(--parle-ink); }

/* actions \u2014 outlined, so a button is a button on whatever it sits on */
.parle-act {
  all: unset;
  display: inline-block;
  cursor: pointer;
  font-family: var(--parle-font);
  font-size: var(--parle-t-body);
  font-weight: 550;
  padding: var(--parle-2) var(--parle-4);
  border-radius: var(--parle-r-full);
  color: var(--parle-ink);
  background: var(--parle-bg);
  box-shadow: inset 0 0 0 1px var(--parle-rule);
  transition: background 160ms var(--parle-motion), opacity 160ms var(--parle-motion);
}
.parle-act:hover { background: var(--parle-raise); }
.parle-act-strong {
  background: var(--parle-accent);
  color: var(--parle-on-accent);
  box-shadow: none;
}
.parle-act-strong:hover { background: var(--parle-accent); opacity: 0.88; }
.parle-link {
  all: unset;
  cursor: pointer;
  font-family: var(--parle-font);
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
  transition: color 160ms var(--parle-motion);
}
.parle-link:hover { color: var(--parle-ink); text-decoration: underline; }
.parle-note { margin: var(--parle-4) 0 0; font-size: var(--parle-t-meta); color: var(--parle-mid); }
/* the footer \u2014 rows declared, never wrapped into */
.parle-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--parle-2);
  border-top: 1px solid var(--parle-line);
  padding: var(--parle-3) var(--parle-4);
  font-size: var(--parle-t-meta);
  color: var(--parle-faint);
}
.parle-footer-row {
  display: flex;
  align-items: center;
  gap: var(--parle-3);
  flex-wrap: wrap;
}
.parle-footer-state { margin-right: auto; color: var(--parle-mid); }

/* the account of every place we asked \u2014 the toolbar surface's whole job */
.parle-coverage { margin: var(--parle-4) 0 0; }
.parle-coverage-name {
  margin: 0 0 var(--parle-1);
  font-size: var(--parle-t-meta);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--parle-faint);
}
.parle-account {
  display: flex;
  justify-content: space-between;
  gap: var(--parle-3);
  padding: var(--parle-1) 0;
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-account-place { color: var(--parle-mid); }
.parle-account-waiting { color: var(--parle-faint); }
.parle-account-refused { color: var(--parle-stop); }
.parle-account-garbled { color: var(--parle-warn); }
.parle-account-found { color: var(--parle-accent); }

/* digest */
.parle-digest {
  margin: var(--parle-4) 0 0;
  padding: var(--parle-3);
  border-radius: var(--parle-r);
  background: var(--parle-raise);
  color: var(--parle-mid);
}
.parle-digest-title { margin: 0 0 var(--parle-2); font-size: var(--parle-t-body); font-weight: 600; color: var(--parle-ink); }
.parle-digest-says { margin: 0 0 var(--parle-2); }
.parle-digest-partial { margin: var(--parle-2) 0 0; font-size: var(--parle-t-meta); }
.parle-digest-wrote { margin: var(--parle-2) 0 0; font-size: var(--parle-t-meta); color: var(--parle-faint); }
.parle-act-digest { margin-top: var(--parle-1); }
.parle-finding { margin: 0 0 var(--parle-3); }
.parle-finding:last-of-type { margin-bottom: 0; }
.parle-finding-says { margin: 0 0 var(--parle-1); color: var(--parle-ink); }
/* disputed: the neutral ink, never the accent and never a warning (ADR 0006) */
.parle-finding-disputed { box-shadow: inset 2px 0 0 var(--parle-rule); padding-left: var(--parle-3); }
.parle-disputed {
  display: block;
  margin-bottom: 2px;
  font-size: var(--parle-t-meta);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--parle-faint);
}
/* citations: underlined always, because they are meant to be followed (ADR 0006) */
.parle-sources { display: flex; flex-wrap: wrap; gap: var(--parle-1) var(--parle-3); }
.parle a.parle-source {
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  cursor: pointer;
}
.parle a.parle-source:hover { color: var(--parle-ink); }
.parle-spinner {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--parle-r-full);
  background: currentColor;
  margin-right: var(--parle-2);
  vertical-align: middle;
  animation: parle-pulse 1.4s var(--parle-motion) infinite;
}
@keyframes parle-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

/* the mark \u2014 top right, only when there is something, still after it arrives */
.parle-pill {
  position: fixed;
  top: var(--parle-4);
  right: var(--parle-4);
  z-index: 2147483646;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--parle-r-full);
  background: var(--parle-bg);
  color: var(--parle-ink);
  box-shadow: var(--parle-lift), inset 0 0 0 1px var(--parle-line);
  cursor: pointer;
  user-select: none;
  font-size: var(--parle-t-meta);
  font-weight: 650;
  transition: transform 160ms var(--parle-motion);
  animation: parle-arrive 420ms var(--parle-motion) both;
}
.parle-pill:hover { transform: scale(1.06); }
.parle-pill[hidden], .parle-pill[data-found="0"] { display: none; }
.parle-pill svg, .parle-close svg { display: block; width: 16px; height: 16px; }
.parle-pill svg:not([fill]), .parle-close svg:not([fill]) { fill: currentColor; }
.parle-pill-count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--parle-r-full);
  background: var(--parle-accent);
  color: var(--parle-on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--parle-bg);
}
.parle-pill-count:empty { display: none; }
/* the announcement: one ring, outward, once */
.parle-pill::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--parle-r-full);
  border: 2px solid var(--parle-accent);
  pointer-events: none;
  animation: parle-ring 1100ms var(--parle-motion) 1 both;
}
@keyframes parle-arrive {
  from { opacity: 0; transform: translateY(-6px) scale(0.8); }
  to { opacity: 1; transform: none; }
}
@keyframes parle-ring {
  from { opacity: 0.55; transform: scale(1); }
  to { opacity: 0; transform: scale(2); }
}

/* the surface \u2014 full screen under 640px, docked right at and above it */
.parle-dock {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  background: var(--parle-bg);
  box-shadow: var(--parle-lift);
  overscroll-behavior: contain;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: parle-open 180ms var(--parle-motion) both;
}
@keyframes parle-open { from { opacity: 0; } to { opacity: 1; } }
@media (min-width: 640px) {
  .parle-dock { inset: 0 0 0 auto; width: clamp(320px, 30vw, 420px); padding-bottom: 0; }
}
/* the way out of the surface, drawn as a button */
.parle-close {
  all: unset;
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + var(--parle-2));
  right: var(--parle-2);
  z-index: 1;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--parle-r-full);
  background: var(--parle-raise);
  cursor: pointer;
  font-family: var(--parle-font);
  font-size: var(--parle-t-head);
  line-height: 1;
  color: var(--parle-mid);
  transition: background 160ms var(--parle-motion), color 160ms var(--parle-motion);
}
.parle-close:hover { background: var(--parle-line); color: var(--parle-ink); }
.parle-dock .parle-head { padding-right: 52px; }
@media (max-width: 639px) {
  .parle-close {
    top: calc(env(safe-area-inset-top, 0px) + var(--parle-3));
    right: var(--parle-3);
    width: 40px;
    height: 40px;
  }
  .parle-dock .parle-head { padding-right: 64px; padding-top: var(--parle-5); }
  .parle-dock .parle-heading {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .parle, .parle *,
  .parle-pill, .parle-pill::after,
  .parle-dock, .parle-close { animation: none !important; transition: none !important; }
  .parle-pill::after { opacity: 0; }
}
`;export{R as P,E as a,D as r};
