(function(){"use strict";function Re(e){return e}const w=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome,V="parle-pill",j=e=>({_tag:"Watch",tabId:e}),q=(e,r,a)=>({_tag:"Sighted",address:e,title:r,referrer:a}),Y=e=>({_tag:"OpenOut",address:e}),G=()=>({_tag:"LookAnyway"}),B=()=>({_tag:"Summarise"}),K=e=>({_tag:"Decide",automatic:e}),Q=()=>({_tag:"OpenDisclosure"}),X=()=>({_tag:"OpenAside"}),H=e=>({_tag:"PauseSite",host:e}),J=e=>({_tag:"ResumeSite",host:e}),Z=()=>({_tag:"OpenSettings"}),ee=(e,r,a)=>({_tag:"Standing",tabId:e,panel:r,aside:a}),re=e=>({_tag:"Told",decision:e}),ae=e=>typeof e=="object"&&e!==null&&"_tag"in e&&typeof e._tag=="string"?e._tag:null,te=e=>e==="undecided"||e==="automatic"||e==="manual",ne=e=>e==="native"||e==="in-page",oe=e=>{switch(ae(e)){case"Standing":{const r=e;if(typeof r.tabId!="number")return null;const a=r.panel;return typeof a!="object"||a===null||!Array.isArray(a.linked)||!Array.isArray(a.accounts)||!ne(r.aside)?null:ee(r.tabId,a,r.aside)}case"Told":{const r=e.decision;return te(r)?re(r):null}default:return null}},le=400,ie=(e,r)=>{let a=null,t=!1;const o=[],i=s=>{if(a===null)return!1;try{return a.postMessage(s),!0}catch{return!1}},p=()=>{if(!t){a=w.runtime.connect({name:e}),a.onMessage.addListener(s=>{const u=oe(s);u!==null&&r(u)}),a.onDisconnect.addListener(()=>{a=null,t||setTimeout(p,le)});for(const s of o)i(s)}};return p(),{say:(s,u=!1)=>(u&&o.push(s),i(s)),close:()=>{t=!0;try{a?.disconnect()}catch{}a=null}}},A=32,se=(e,r,a)=>{if(a<=r)return null;const t=e.slice(r,a);return t.trim()===""?null:{exact:t,prefix:e.slice(Math.max(0,r-A),r),suffix:e.slice(a,a+A),wasAt:r}},pe=e=>{const r=()=>{const a=document.getSelection();if(a===null||a.isCollapsed||a.rangeCount===0)return;const t=a.toString(),o=document.body.textContent??"",i=o.indexOf(t);e(i===-1?{exact:t,prefix:"",suffix:"",wasAt:0}:se(o,i,i+t.length))};return document.addEventListener("selectionchange",r,{passive:!0}),()=>document.removeEventListener("selectionchange",r)},x=e=>e.linked.length+e.passing.length+e.topical.length,de=e=>{try{const r=new URL(e);return r.protocol!=="http:"&&r.protocol!=="https:"?null:r.hostname.replace(/^www\./,"")}catch{return null}},ce=e=>e.length<=1?e[0]??"Nowhere":`${e.slice(0,-1).join(", ")} and ${e[e.length-1]}`,n=(e,r,a)=>{const t=document.createElement(e);return r!==""&&(t.className=r),a!==void 0&&(t.textContent=a),t},m=(e,r,a)=>{const t=n("button",e,r);return t.addEventListener("click",o=>{o.preventDefault(),a()}),t},ue=e=>e===1?"also submitted once":`also submitted ${e} times`,T=(e,r)=>{const a=n("a","parle-row");a.href=e.permalink,a.target="_blank",a.rel="noreferrer noopener",a.addEventListener("click",o=>{o.preventDefault(),r.openOut(e.permalink)}),a.appendChild(n("span","parle-title",e.title));const t=n("div","parle-facts");return t.appendChild(n("span","parle-network",e.networkName)),t.appendChild(n("span","",`${e.score} points`)),t.appendChild(n("span","",`${e.commentCount} ${e.commentCount===1?"comment":"comments"}`)),e.age!==""&&t.appendChild(n("span","",e.age)),e.alsoSubmitted>0&&t.appendChild(n("span","parle-repeat",ue(e.alsoSubmitted))),a.appendChild(t),a},y=(e,r,a,t,o)=>{if(t.length===0)return null;const i=n("section",`parle-group parle-group-${e}`),p=n("h2","parle-group-name",`${r} `);p.appendChild(n("span","parle-group-note",a)),i.appendChild(p);for(const s of t)i.appendChild(T(s,o));return i},fe=(e,r)=>{const a=n("section","parle-folded");a.appendChild(n("p","parle-folded-says",e.says));const t=n("div","parle-folded-rows");t.hidden=!0;for(const i of e.rows)t.appendChild(T(i,r));const o=m("parle-act parle-act-folded",e.label,()=>{t.hidden=!1,o.remove()});return a.appendChild(o),a.appendChild(t),a},he=(e,r)=>{const a=n("a","parle-source");return a.href=e.permalink,a.target="_blank",a.rel="noreferrer noopener",a.addEventListener("click",t=>{t.preventDefault(),r.openOut(e.permalink)}),a.appendChild(n("span","parle-source-label",e.comment?`${e.label} \u2014 the comment`:e.label)),a},ge=(e,r)=>{const a=n("div",e.contested?"parle-finding parle-finding-disputed":"parle-finding");e.contested&&a.appendChild(n("span","parle-disputed","Someone there disagreed")),a.appendChild(n("p","parle-finding-says",e.statement));const t=n("div","parle-sources");for(const o of e.sources)t.appendChild(he(o,r));return a.appendChild(t),a},me=(e,r)=>{if(e.says.text===""&&e.findings.length===0&&e.offer===null)return null;const a=n("section",`parle-digest parle-tone-${e.says.tone}`);e.says.text!==""&&a.appendChild(n("h2","parle-digest-title",e.says.text));for(const o of e.findings)a.appendChild(ge(o,r));e.partial&&a.appendChild(n("p","parle-digest-partial","This is part of an answer \u2014 some of it could not be traced to a comment."));const t=e.offer;return t!==null&&(t.says!==""&&a.appendChild(n("p","parle-digest-says",t.says)),a.appendChild(m("parle-act parle-act-digest",t.label,t.kind==="connect"?r.openSettings:r.summarise))),e.wrote!==null&&a.appendChild(n("p","parle-digest-wrote",e.wrote)),a},_=e=>e.waitingOn.length===0?"Still looking.":`Still looking \u2014 ${e.waitingOn.join(", ")}`,ve=e=>{const r=x(e);return r>0?`${r} discussion${r===1?"":"s"} on this page.`:e.stillLooking?_(e):e.folded!==null?e.folded.says:e.foundNothing?`Nobody has discussed this page. ${ce(e.answeredBy)} answered, with nothing.`:e.couldNotAsk?"Parle could not find out. Nowhere answered \u2014 which is not the same as nobody discussing it.":"Nothing has been asked about this page yet."},be=(e,r)=>n("div",`${r} parle-tone-${e.tone}`,e.text),we=(e,r)=>{const a=de(e.address);if(a===null)return null;const t=e.restraint!==null&&e.restraint.kind==="site-paused";return m("parle-link",t?`Resume on ${a}`:`Pause on ${a}`,()=>t?r.resumeSite(a):r.pauseSite(a))},xe=(e,r)=>{const a=n("footer","parle-footer"),t=n("div","parle-footer-row"),o=we(e,r);return o!==null&&t.appendChild(o),t.appendChild(m("parle-link","Settings",r.openSettings)),a.appendChild(t),a},ye=e=>{const r=n("header","parle-head");return r.appendChild(n("h1","parle-heading",e.heading)),r.appendChild(n("div","parle-address",e.address)),r},L=(e,r,a)=>{e.textContent="",e.className="parle",e.appendChild(ye(r));const t=n("div","parle-body"),o=[y("linked","About this page","their own link points here",r.linked,a),y("passing","Came up elsewhere","linked inside a conversation about something else",r.passing,a),y("topical","On this topic","matched by title \u2014 not provably this page",r.topical,a)];for(const p of o)p!==null&&t.appendChild(p);if(r.folded!==null&&t.appendChild(fe(r.folded,a)),r.windowed!==null&&t.appendChild(be(r.windowed,"parle-note")),x(r)===0&&r.folded===null)t.appendChild(n("p","parle-said",r.restraint===null?ve(r):r.restraint.says));else if(r.stillLooking){const p=n("div","parle-notice parle-tone-waiting"),s=n("span","");s.appendChild(n("span","parle-spinner")),s.appendChild(document.createTextNode(_(r))),p.appendChild(s),t.appendChild(p)}const i=me(r.digest,a);i!==null&&t.appendChild(i),e.appendChild(t),e.appendChild(xe(r,a))},ke=`
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
`,z="__parle_pill_mounted__",I="http://www.w3.org/2000/svg",Ce=()=>{const e=document.createElementNS(I,"svg");e.setAttribute("viewBox","0 0 16 16"),e.setAttribute("aria-hidden","true");const r=document.createElementNS(I,"path");return r.setAttribute("d","M8 1.6c-3.6 0-6.5 2.3-6.5 5.2 0 1.7 1 3.2 2.5 4.1L3.3 14l3.2-1.7c.5.1 1 .1 1.5.1 3.6 0 6.5-2.3 6.5-5.2S11.6 1.6 8 1.6z"),e.appendChild(r),e},Se=e=>`${e} discussion${e===1?"":"s"}`,$=e=>{if("showPopover"in e)try{e.setAttribute("popover","manual"),e.showPopover()}catch{e.removeAttribute("popover")}},Ee={matches:["http://*/*","https://*/*"],registration:"runtime",runAt:"document_idle",allFrames:!1,main:()=>{const e=window;if(e[z]===!0)return;e[z]=!0;let r=null,a="in-page",t=null,o=null,i=null,p=null,s=null,u=null;const ze=()=>{if(t!==null)return;const l=document.createElement("div");l.style.setProperty("all","initial");const d=l.attachShadow({mode:"closed"}),h=document.createElement("style");h.textContent=ke,d.appendChild(h);const f=document.createElement("button");f.className="parle-pill",f.type="button",f.appendChild(Ce());const N=document.createElement("span");N.className="parle-pill-count",f.appendChild(N),f.addEventListener("click",Ie),d.appendChild(f),document.documentElement.appendChild(l),$(f),t=l,o=d,i=f,p=N},C=()=>{t!==null&&(t.remove(),t=null,o=null,i=null,p=null,s=null,u=null)},Ie=()=>{if(a==="native"){c.say(X());return}s===null?$e():S()},$e=()=>{if(o===null||s!==null||r===null)return;const l=document.createElement("div");l.className="parle-dock",l.setAttribute("role","dialog"),l.setAttribute("aria-label","Parle");const d=document.createElement("button");d.className="parle-close",d.type="button",d.setAttribute("aria-label","Close"),d.textContent="\xD7",d.addEventListener("click",S),l.appendChild(d);const h=document.createElement("div");h.className="parle",l.appendChild(h),o.appendChild(l),$(l),s=l,u=h,L(h,r,P),d.focus({preventScroll:!0})},S=()=>{s!==null&&(s.remove(),s=null,u=null,i?.focus({preventScroll:!0}))},Oe=()=>{if(r===null)return;const l=x(r);if(l===0){C();return}if(ze(),p!==null&&(p.textContent=String(Math.min(l,99))),i!==null){i.dataset.found=String(l);const d=`Parle \u2014 ${Se(l)}`;i.setAttribute("aria-label",d),i.title=d}u!==null&&L(u,r,P)},c=ie(V,l=>{l._tag==="Standing"&&(r=l.panel,a=l.aside,Oe())}),P={openOut:l=>c.say(Y(l)),lookAnyway:()=>c.say(G()),summarise:()=>c.say(B()),decide:l=>c.say(K(l)),openDisclosure:()=>c.say(Q()),openSettings:()=>c.say(Z()),pauseSite:l=>c.say(H(l)),resumeSite:l=>c.say(J(l))},R=l=>{s===null||l.key!=="Escape"||(l.stopPropagation(),S())};window.addEventListener("keydown",R,!0),c.say(j(null),!0);const M=()=>{c.say(q(location.href,document.title,document.referrer),!0)};M();let D=location.href;const E=()=>{location.href!==D&&(D=location.href,C(),M())};window.addEventListener("popstate",E),window.addEventListener("hashchange",E);const W=new MutationObserver(E),U=document.querySelector("title");U!==null&&W.observe(U,{childList:!0});const Pe=pe(()=>{});window.addEventListener("pagehide",()=>{Pe(),W.disconnect(),window.removeEventListener("keydown",R,!0),C(),c.close()})}};function v(e,...r){}const Ne={debug:(...e)=>v(console.debug,...e),log:(...e)=>v(console.log,...e),warn:(...e)=>v(console.warn,...e),error:(...e)=>v(console.error,...e)};var O=class F extends Event{static EVENT_NAME=k("wxt:locationchange");constructor(r,a){super(F.EVENT_NAME,{}),this.newUrl=r,this.oldUrl=a}};function k(e){return`${w?.runtime?.id}:pill:${e}`}const Ae=typeof globalThis.navigation?.addEventListener=="function";function Te(e){let r,a=!1;return{run(){a||(a=!0,r=new URL(location.href),Ae?globalThis.navigation.addEventListener("navigate",t=>{const o=new URL(t.destination.url);o.href!==r.href&&(window.dispatchEvent(new O(o,r)),r=o)},{signal:e.signal}):e.setInterval(()=>{const t=new URL(location.href);t.href!==r.href&&(window.dispatchEvent(new O(t,r)),r=t)},1e3))}}}var _e=class g{static SCRIPT_STARTED_MESSAGE_TYPE=k("wxt:content-script-started");id;abortController;locationWatcher=Te(this);constructor(r,a){this.contentScriptName=r,this.options=a,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(r){return this.abortController.abort(r)}get isInvalid(){return w.runtime?.id==null&&this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(r){return this.signal.addEventListener("abort",r),()=>this.signal.removeEventListener("abort",r)}block(){return new Promise(()=>{})}setInterval(r,a){const t=setInterval(()=>{this.isValid&&r()},a);return this.onInvalidated(()=>clearInterval(t)),t}setTimeout(r,a){const t=setTimeout(()=>{this.isValid&&r()},a);return this.onInvalidated(()=>clearTimeout(t)),t}requestAnimationFrame(r){const a=requestAnimationFrame((...t)=>{this.isValid&&r(...t)});return this.onInvalidated(()=>cancelAnimationFrame(a)),a}requestIdleCallback(r,a){const t=requestIdleCallback((...o)=>{this.signal.aborted||r(...o)},a);return this.onInvalidated(()=>cancelIdleCallback(t)),t}addEventListener(r,a,t,o){a==="wxt:locationchange"&&this.isValid&&this.locationWatcher.run(),r.addEventListener?.(a.startsWith("wxt:")?k(a):a,t,{...o,signal:this.signal})}notifyInvalidated(){this.abort("Content script context invalidated"),Ne.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(g.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:g.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},"*")}verifyScriptStartedEvent(r){const a=r.detail?.contentScriptName===this.contentScriptName,t=r.detail?.messageId===this.id;return a&&!t}listenForNewerScripts(){const r=a=>{!(a instanceof CustomEvent)||!this.verifyScriptStartedEvent(a)||this.notifyInvalidated()};document.addEventListener(g.SCRIPT_STARTED_MESSAGE_TYPE,r),this.onInvalidated(()=>document.removeEventListener(g.SCRIPT_STARTED_MESSAGE_TYPE,r))}};function We(){}function b(e,...r){}const Le={debug:(...e)=>b(console.debug,...e),log:(...e)=>b(console.log,...e),warn:(...e)=>b(console.warn,...e),error:(...e)=>b(console.error,...e)};return(async()=>{try{const{main:e,...r}=Ee;return await e(new _e("pill",r))}catch(e){throw Le.error('The content script "pill" crashed on startup!',e),e}})()})();
