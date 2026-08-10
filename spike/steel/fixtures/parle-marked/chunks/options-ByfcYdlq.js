import{l as _}from"./Surface-ipwKupXw.js";import{bR as $,dg as C,aC as Y,cx as N,bS as K,d2 as V,al as J,X as F,ct as Q,dh as H,d8 as Z,di as ee,d7 as ae,dj as te,dk as re,dl as oe,d6 as ne,dm as ie,dn as se,dp as le,de,dq as pe}from"./Controls-oUcAEllF.js";import{c as ce,F as he,d as ue}from"./_virtual_wxt-plugins-Y4quc_xq.js";const me=`
:root {
  color-scheme: light dark;

  --parle-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;

  --parle-t-meta: 12px;
  --parle-t-body: 14px;
  --parle-t-lead: 15px;
  --parle-t-head: 22px;

  --parle-1: 4px;
  --parle-2: 8px;
  --parle-3: 12px;
  --parle-4: 16px;
  --parle-5: 24px;
  --parle-6: 40px;

  --parle-r: 10px;
  --parle-r-sm: 6px;

  --parle-bg: #ffffff;
  --parle-raise: #f4f5f7;
  --parle-ink: #14161a;
  --parle-mid: #5b6270;
  --parle-faint: #6f7683;
  --parle-line: rgba(20, 22, 26, 0.10);
  --parle-rule: rgba(20, 22, 26, 0.20);
  --parle-accent: #0d7a52;
  --parle-stop: #99291c;

  --parle-motion: cubic-bezier(0.2, 0.75, 0.3, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --parle-bg: #101216;
    --parle-raise: #191c22;
    --parle-ink: #e8eaef;
    --parle-mid: #a2a9b6;
    --parle-faint: #8b929f;
    --parle-line: rgba(232, 234, 239, 0.11);
    --parle-rule: rgba(232, 234, 239, 0.24);
    --parle-accent: #57d39b;
    --parle-stop: #f0a396;
  }
}

html, body { margin: 0; padding: 0; background: var(--parle-bg); }

.parle-settings {
  font-family: var(--parle-font);
  font-size: var(--parle-t-body);
  line-height: 1.6;
  color: var(--parle-ink);
  max-width: 42rem;
  margin: 0 auto;
  padding: var(--parle-6) var(--parle-5) 96px;
  box-sizing: border-box;
  accent-color: var(--parle-accent);
  -webkit-font-smoothing: antialiased;
}
.parle-settings *, .parle-settings *::before, .parle-settings *::after { box-sizing: border-box; }

.parle-title {
  font-size: var(--parle-t-head);
  font-weight: 650;
  letter-spacing: -0.02em;
  margin: 0 0 var(--parle-3);
}
.parle-says { margin: 0 0 var(--parle-3); }
.parle-quiet { color: var(--parle-mid); font-size: var(--parle-t-meta); margin: 0 0 var(--parle-1); }

.parle-disclosure {
  background: var(--parle-raise);
  border-radius: var(--parle-r);
  padding: var(--parle-4) var(--parle-4) var(--parle-2);
}

/*
 * The sentences a reader is entitled to hold us to: what the list cannot do,
 * what a Digest costs, where a key really lives. A rule down the left in the
 * accent and nothing else \u2014 not a warning about a fault, the lines we most
 * want read. Nothing else on the page wears it, so the mark keeps meaning
 * something.
 */
.parle-honest {
  box-shadow: inset 2px 0 0 var(--parle-accent);
  padding-left: var(--parle-3);
  color: var(--parle-ink);
}

.parle-notice-line {
  margin: var(--parle-3) 0 0;
  padding: var(--parle-2) var(--parle-3);
  border-radius: var(--parle-r-sm);
  background: var(--parle-raise);
  color: var(--parle-accent);
  font-size: var(--parle-t-meta);
}

.parle-section { margin: var(--parle-6) 0 0; }
.parle-section-title {
  font-size: var(--parle-t-meta);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--parle-faint);
  margin: 0 0 var(--parle-3);
}
.parle-sub-title { font-size: var(--parle-t-lead); font-weight: 650; margin: var(--parle-5) 0 var(--parle-2); }

.parle-toggle { padding: var(--parle-3) 0; }
.parle-toggle + .parle-toggle { border-top: 1px solid var(--parle-line); }
.parle-toggle-line { display: flex; align-items: center; gap: var(--parle-2); cursor: pointer; }
.parle-toggle-label { font-weight: 600; }
.parle-toggle-says {
  margin: var(--parle-1) 0 0 var(--parle-5);
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
}
.parle-toggle-off { opacity: 0.55; }
.parle-toggle-off .parle-toggle-line { cursor: default; }

/*
 * The long version of the disclosure, closed by default.
 *
 * Styled as a quiet line rather than a panel: it is the detail a reader goes
 * looking for, not something the page argues with them about. Everything in it
 * is in the DOM whether or not it is open, so find-in-page still reaches it.
 */
.parle-longer { margin: var(--parle-2) 0 var(--parle-3); }
.parle-longer summary {
  cursor: pointer;
  font-size: var(--parle-t-meta);
  color: var(--parle-mid);
}
.parle-longer summary:hover { color: var(--parle-ink); }
.parle-longer .parle-sub-title { margin: var(--parle-3) 0 var(--parle-1); }
.parle-plain { list-style: none; margin: 0; padding: 0; }
.parle-plain-item {
  padding: var(--parle-2) 0;
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
}
.parle-plain-item + .parle-plain-item { border-top: 1px solid var(--parle-line); }

.parle-rules { margin: var(--parle-3) 0 var(--parle-1); }

.parle-built-in {
  margin: var(--parle-3) 0;
  background: var(--parle-raise);
  border-radius: var(--parle-r-sm);
  padding: var(--parle-2) var(--parle-3);
}
.parle-built-in summary { cursor: pointer; font-weight: 600; }
.parle-category { margin: var(--parle-3) 0 0; }
.parle-category-title { font-size: var(--parle-t-meta); margin: 0 0 2px; font-weight: 650; }
.parle-category-domains {
  margin: 0;
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
  word-break: break-word;
}

.parle-sites { list-style: none; margin: 0 0 var(--parle-2); padding: 0; }
.parle-site {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--parle-3);
  padding: var(--parle-2) 0;
}
.parle-site + .parle-site { border-top: 1px solid var(--parle-line); }
.parle-site-name { word-break: break-all; }
.parle-empty-line { color: var(--parle-mid); margin: 0 0 var(--parle-2); font-size: var(--parle-t-meta); }

.parle-adder { margin: var(--parle-2) 0 var(--parle-1); }
.parle-adder-label { display: block; font-size: var(--parle-t-meta); font-weight: 600; }
.parle-adder-box {
  display: block;
  width: 100%;
  margin: var(--parle-2) 0 0;
  padding: var(--parle-2) var(--parle-3);
  font: inherit;
  color: var(--parle-ink);
  background: var(--parle-bg);
  border: 1px solid var(--parle-rule);
  border-radius: var(--parle-r-sm);
  transition: border-color 160ms var(--parle-motion);
}
.parle-adder-box:focus { outline: none; border-color: var(--parle-accent); }
.parle-adder-hint { margin: var(--parle-1) 0 var(--parle-2); color: var(--parle-mid); font-size: var(--parle-t-meta); }

/*
 * One action shape across the whole product.
 *
 * The panel's buttons are pills; these were 6px chips, and the first-run
 * screen's were 8px. Three radii for one gesture is three designers, and a
 * reader moving from the mark to this page should not be able to tell that two
 * stylesheets drew them.
 */
.parle-action {
  font: inherit;
  font-size: var(--parle-t-meta);
  font-weight: 550;
  padding: var(--parle-2) var(--parle-4);
  border-radius: 999px;
  border: none;
  box-shadow: inset 0 0 0 1px var(--parle-rule);
  background: var(--parle-bg);
  color: var(--parle-ink);
  cursor: pointer;
  transition: background 160ms var(--parle-motion);
}
.parle-action:hover { background: var(--parle-raise); }
.parle-action-loud { color: var(--parle-stop); }
.parle-inline-action {
  font: inherit;
  font-size: var(--parle-t-meta);
  padding: var(--parle-1) var(--parle-3);
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--parle-mid);
  cursor: pointer;
  flex: none;
  transition: background 160ms var(--parle-motion), color 160ms var(--parle-motion);
}
.parle-inline-action:hover { color: var(--parle-ink); background: var(--parle-raise); }

.parle-settings :focus-visible {
  outline: 2px solid var(--parle-accent);
  outline-offset: 2px;
  border-radius: var(--parle-r-sm);
}

.parle-forget { padding: var(--parle-3) 0; }
.parle-forget + .parle-forget { border-top: 1px solid var(--parle-line); }

.parle-foot {
  margin: var(--parle-6) 0 0;
  padding-top: var(--parle-4);
  border-top: 1px solid var(--parle-line);
  color: var(--parle-mid);
  font-size: var(--parle-t-meta);
}

@media (prefers-reduced-motion: reduce) {
  .parle-settings *, .parle-settings { transition: none !important; animation: none !important; }
}
`,G=r=>r.length<=1?r[0]??"":`${r.slice(0,-1).join(", ")} and ${r[r.length-1]}`,I={title:"What Parle sends",paragraphs:["Parle sends the address of the page you are reading to Hacker News, Reddit and X, to see whether anyone has discussed it. They see it. It is not anonymous.","It skips banks, mail, health, government, adult, social and private addresses, and addresses that visibly carry a token. It never sends what comes after the #.","That is a list, so it will miss things. Read it below, add to it, override it, or turn automatic lookups off."],build:(r,a)=>r.length===0||a.length===0?null:`In this build, the code that would ask ${G(r)} is not included at all, so it is ${G(a)} that see the addresses of the pages you read.`},O={title:"The longer version",refuses:{title:"Three things Parle will not claim",items:["Not \u201Cyour browsing is private\u201D. It is not. Every page you read that is not skipped produces requests to other companies carrying its address.","Not \u201Cwe exclude addresses carrying credentials\u201D. The rules catch several common shapes. A short share link that looks like an ordinary address cannot be detected at all.","Not \u201Cwe protect sensitive categories\u201D. A list of sites cannot cover health, internal company tools or documents, and the best lists available are measurably missing well-known providers."]},build:{title:"In this build",items:["Reddit is asked with your own Reddit cookies, because it answers nothing without them. Hacker News is asked with no account and no key.","There is no server run by this project, and the extension never contacts one."]}},x={title:"Automatic lookups",label:"Look pages up as I read them",on:"Pages are looked up as you open them. The toolbar button works everywhere.",off:"Nothing is sent as you browse. The toolbar button still looks up any web page, including skipped ones."},E={title:"Site front pages",label:"Show every Discussion, even on site front pages",off:"On a site's front page \u2014 facebook.com rather than a page on it \u2014 old Discussions are folded behind one line you can open. Anything from the last month is shown as usual.",on:"Every Discussion is shown everywhere. On a site's front page that can mean dozens of conversations about unrelated things."},k={title:"Where Parle looks",intro:"Turn any of these off and Parle stops asking it, whether or not you open the panel.",hackernews:{name:"Hacker News",says:"Searches by address and title. Public, no account \u2014 it costs your own connection, not anyone's key."},reddit:{name:"Reddit",says:"Searches by address, using the Reddit session already in your browser. The request goes out as you, and shares your Reddit rate limit."},x:{name:"X",says:"Searches by address, using the X session already in your browser \u2014 there is no other way to ask. It goes out as you, so if X decides it looks automated your account is rate-limited, not ours. Asked only once another site has found a discussion of this page. Never posts, likes or follows."},compiledOut:"Not in this build."},c={title:"Digests",intro:"A Digest is Parle's summary of what the discussions it found actually said. It needs an AI Provider you connect. Everything else on this page works whether or not you do.",stored:"Kept on this device as ordinary text \u2014 an extension has nowhere private to put a key, so anything that can read your browser's profile can read it. Use one you can revoke.",cost:"Writing one reads the comments of the discussions found on a page and sends them to whatever you connect. So the panel asks first, every time.",choose:"What Parle should ask",none:{name:"Nothing",says:"No Digests. Discussions are still found and listed."},byok:{name:"An API key of your own",says:"OpenAI, or anything that speaks the same shape \u2014 a local model, or another company's endpoint. This one keeps working because of your agreement with whoever issued the key, not ours with anyone.",key:"API key",keySave:"Save this key",keyHint:"Kept on this device, sent only to the address below.",baseUrl:"Address to send it to",baseUrlHint:"Empty means OpenAI. A local model might be http://localhost:8080/v1.",model:"Model",modelHint:"Empty asks for a small, current one.",saved:"Key saved.",missing:"Paste a key first."},onDevice:{name:"This browser's built-in model",says:"No key, no account, and the comments never leave this machine.",absent:"This browser does not offer one.",present:"This browser has one ready."},codex:{name:"ChatGPT",says:"Bills your own ChatGPT subscription. There is no sign-in button for it yet \u2014 signing in from an extension is unresolved on Safari \u2014 so it takes a token you already have. A rough edge, labelled as one.",token:"Access token",tokenSave:"Save this token",tokenHint:"Kept on this device, exactly like an API key.",model:"Model",saved:"Token saved."},forget:"Forget this key",forgotten:"Forgotten.",chosen:r=>`Parle will ask ${r}.`},m={title:"Pages Parle skips",incomplete:"A list is incomplete by nature. It will miss services nobody has told us about, and it cannot see a private share link that looks ordinary. A floor, not a guarantee.",rules:{title:"Always skipped, by rule",says:"These need no list and cannot go out of date, because they are facts about the address: not a web page at all, on your own network, or a name that only exists inside it.",shapes:"Parle also skips addresses that visibly carry a password, a token, an email address or a long random code. That is pattern-matching, not a guarantee: a short share link that looks ordinary cannot be caught."},builtIn:{title:"The built-in list",says:"Sites Parle does not look up unless you say otherwise. Grouped by why they are here."},yours:{title:"Sites you added",empty:"None yet."},overridden:{title:"Built-in entries you turned off",says:"Looked up again, even though they are on the built-in list.",empty:"None yet."},paused:{title:"Sites you paused",says:"Paused from the panel, undone here or there. Not a judgement about the site.",empty:"None yet."},add:{label:"Add a site to skip",hint:"example.com, or example.com/private. Subdomains are covered.",action:"Skip this site",rejected:"That is not a site address."},allow:{label:"Look up a site anyway",hint:"Overrides the built-in list for one site.",action:"Look it up anyway"},remove:"Remove",resume:"Resume"},ge={banking:"Banks and financial accounts",webmail:"Mail",health:"Health",documents:"Documents and file shares",calendar:"Calendars and meetings",search:"Search engines",social:"Social sites Parle reads rather than asks",government:"Government",adult:"Adult"},b={title:"What this device remembers",everything:{action:"Forget everything",says:"Everything Parle knows about discussions it found, built from pages you had already opened."},lookupRecord:{action:"Forget only the record of what was looked up",says:"The dated note of which addresses Parle asked about, kept so it does not ask twice \u2014 and which of them turned out to be a site's front page. This is the record of what you read, and it is stored scrambled."},kept:"Your settings are not affected by either.",done:"Done."},B={version:r=>`Skip list, version ${r}.`,source:"Parle is AGPL-3.0. Everything on this page happens on this device."},t=(r,a,o)=>{const i=document.createElement(r);return a!==""&&(i.className=a),o!==void 0&&(i.textContent=o),i},w=(r,a,o)=>{const i=t("button",r,a);return i.type="button",i.addEventListener("click",o),i},f=r=>{const a=t("section","parle-section");return a.appendChild(t("h2","parle-section-title",r)),a},R=(r,a,o,i,h)=>{const u=t("div",`parle-toggle${i?"":" parle-toggle-off"}`),l=t("label","parle-toggle-line"),n=document.createElement("input");return n.type="checkbox",n.checked=o,n.disabled=!i,n.addEventListener("change",()=>h(n.checked)),l.appendChild(n),l.appendChild(t("span","parle-toggle-label",r)),u.appendChild(l),u.appendChild(t("p","parle-toggle-says",a)),u},z=(r,a,o)=>{if(r.length===0)return t("p","parle-empty-line",a);const i=t("ul","parle-sites");return r.forEach((h,u)=>{const l=t("li","parle-site");l.appendChild(t("span","parle-site-name",h.label)),l.appendChild(w("parle-inline-action",h.action,()=>o(u))),i.appendChild(l)}),i},U=(r,a,o,i)=>{const h=t("div","parle-adder"),u=document.createElement("label");u.className="parle-adder-label",u.textContent=r;const l=document.createElement("input");l.type="text",l.className="parle-adder-box",l.placeholder="example.com",u.appendChild(l),h.appendChild(u),h.appendChild(t("p","parle-adder-hint",a));const n=()=>{const d=l.value;l.value="",i(d)};return l.addEventListener("keydown",d=>{d.key==="Enter"&&n()}),h.appendChild(w("parle-action",o,n)),h},L={hackernews:k.hackernews,reddit:k.reddit,x:k.x},P=(r,a,o,i,h,u)=>{const l=t("div",`parle-toggle${h?"":" parle-toggle-off"}`),n=t("label","parle-toggle-line"),d=document.createElement("input");return d.type="radio",d.name="parle-provider",d.checked=i,d.disabled=!h,d.addEventListener("change",()=>{d.checked&&u()}),n.appendChild(d),n.appendChild(t("span","parle-toggle-label",a)),l.appendChild(n),l.appendChild(t("p","parle-toggle-says",o)),l},j=(r,a,o,i,h,u)=>{const l=t("div","parle-adder"),n=document.createElement("label");n.className="parle-adder-label",n.textContent=r;const d=document.createElement("input");d.type="password",d.className="parle-adder-box",d.autocomplete="off",d.placeholder=o?"A key is saved. Type a new one to replace it.":"",n.appendChild(d),l.appendChild(n),l.appendChild(t("p","parle-adder-hint",a));const g=()=>{const e=d.value;d.value="",h(e)};return d.addEventListener("keydown",e=>{e.key==="Enter"&&g()}),l.appendChild(w("parle-action",i,g)),o&&l.appendChild(w("parle-inline-action",c.forget,u)),l},M=(r,a,o,i,h)=>{const u=t("div","parle-adder"),l=document.createElement("label");l.className="parle-adder-label",l.textContent=r;const n=document.createElement("input");n.type="text",n.className="parle-adder-box",n.value=o,n.placeholder=i,l.appendChild(n),u.appendChild(l),u.appendChild(t("p","parle-adder-hint",a));const d=()=>h(n.value);return n.addEventListener("keydown",g=>{g.key==="Enter"&&d()}),n.addEventListener("change",d),u},ye=r=>{const a=new Map;for(const h of r.entries){const u=a.get(h.category);u===void 0?a.set(h.category,[h.domain]):u.push(h.domain)}const o=t("details","parle-built-in"),i=document.createElement("summary");i.textContent=`${m.builtIn.title} \u2014 ${r.entries.length} sites`,o.appendChild(i),o.appendChild(t("p","parle-says",m.builtIn.says));for(const[h,u]of a){const l=t("div","parle-category");l.appendChild(t("h4","parle-category-title",ge[h])),l.appendChild(t("p","parle-category-domains",u.join(", "))),o.appendChild(l)}return o},ve=()=>{const r=t("details","parle-longer");r.id="longer";const a=document.createElement("summary");a.textContent=O.title,r.appendChild(a);for(const o of[O.refuses,O.build]){r.appendChild(t("h3","parle-sub-title",o.title));const i=t("ul","parle-plain");for(const h of o.items)i.appendChild(t("li","parle-plain-item",h));r.appendChild(i)}return r},be=(r,a,o)=>{r.textContent="",r.className="parle-settings";const i=t("header","parle-disclosure");i.appendChild(t("h1","parle-title",I.title));for(const s of I.paragraphs)i.appendChild(t("p","parle-says",s));const h=I.build(a.compiledOut.map(s=>L[s].name),["hackernews","reddit","x"].filter(s=>!a.compiledOut.includes(s)).map(s=>L[s].name));h!==null&&i.appendChild(t("p","parle-says parle-honest",h)),i.appendChild(ve()),r.appendChild(i),a.notice!==null&&r.appendChild(t("div","parle-notice-line",a.notice));const u=f(x.title);u.appendChild(R(x.label,a.settings.automatic?x.on:x.off,a.settings.automatic,!0,s=>o.setAutomatic(s))),r.appendChild(u);const l=f(E.title);l.appendChild(R(E.label,a.settings.everyDiscussion?E.on:E.off,a.settings.everyDiscussion,!0,s=>o.setEveryDiscussion(s))),r.appendChild(l);const n=f(k.title);n.appendChild(t("p","parle-says",k.intro));for(const s of["hackernews","reddit","x"]){const v=L[s],D=a.compiledOut.includes(s);n.appendChild(R(v.name,D?`${v.says} ${k.compiledOut}`:v.says,a.settings.networks[s]&&!D,!D,X=>o.setNetwork(s,X)))}r.appendChild(n);const d=f(c.title);d.appendChild(t("p","parle-says",c.intro)),d.appendChild(t("p","parle-says parle-honest",c.cost)),d.appendChild(t("h3","parle-sub-title",c.choose));const g=a.settings.provider.connection;d.appendChild(P("none",c.none.name,c.none.says,g==="none",!0,()=>o.setProvider("none"))),d.appendChild(P("byok",c.byok.name,c.byok.says,g==="byok",!0,()=>o.setProvider("byok"))),d.appendChild(P("on-device",c.onDevice.name,a.onDevice?`${c.onDevice.says} ${c.onDevice.present}`:`${c.onDevice.says} ${c.onDevice.absent}`,g==="on-device",a.onDevice,()=>o.setProvider("on-device"))),d.appendChild(P("codex",c.codex.name,c.codex.says,g==="codex",!0,()=>o.setProvider("codex"))),d.appendChild(t("p","parle-says parle-honest",c.stored)),d.appendChild(j(c.byok.key,c.byok.keyHint,$(a.settings.provider.byok.apiKey),c.byok.keySave,s=>o.setByok({apiKey:s}),()=>o.forgetProviderKey("byok"))),d.appendChild(M(c.byok.baseUrl,c.byok.baseUrlHint,a.settings.provider.byok.baseUrl,"https://api.openai.com/v1",s=>o.setByok({baseUrl:s}))),d.appendChild(M(c.byok.model,c.byok.modelHint,a.settings.provider.byok.model,"gpt-4o-mini",s=>o.setByok({model:s}))),d.appendChild(j(c.codex.token,c.codex.tokenHint,$(a.settings.provider.codex.token),c.codex.tokenSave,s=>o.setCodex({token:s}),()=>o.forgetProviderKey("codex"))),r.appendChild(d);const e=f(m.title);e.appendChild(t("p","parle-says parle-honest",m.incomplete));const p=t("div","parle-rules");p.appendChild(t("h3","parle-sub-title",m.rules.title)),p.appendChild(t("p","parle-says",m.rules.says)),p.appendChild(t("p","parle-says parle-honest",m.rules.shapes)),e.appendChild(p),e.appendChild(ye(a.artifact)),e.appendChild(t("h3","parle-sub-title",m.yours.title)),e.appendChild(z(a.settings.excluded.map(s=>({label:C(s),action:m.remove})),m.yours.empty,s=>{const v=a.settings.excluded[s];v!==void 0&&o.removeExclusion(v)})),e.appendChild(U(m.add.label,m.add.hint,m.add.action,s=>o.addExclusion(s))),e.appendChild(t("h3","parle-sub-title",m.overridden.title)),e.appendChild(t("p","parle-says",m.overridden.says)),e.appendChild(z(a.settings.allowedAnyway.map(s=>({label:C(s),action:m.remove})),m.overridden.empty,s=>{const v=a.settings.allowedAnyway[s];v!==void 0&&o.removeAllowAnyway(v)})),e.appendChild(U(m.allow.label,m.allow.hint,m.allow.action,s=>o.allowAnyway(s))),e.appendChild(t("h3","parle-sub-title",m.paused.title)),e.appendChild(t("p","parle-says",m.paused.says)),e.appendChild(z(a.settings.paused.map(s=>({label:s,action:m.resume})),m.paused.empty,s=>{const v=a.settings.paused[s];v!==void 0&&o.resumeSite(v)})),r.appendChild(e);const y=f(b.title),T=t("div","parle-forget");T.appendChild(t("p","parle-says",b.everything.says)),T.appendChild(w("parle-action parle-action-loud",b.everything.action,()=>o.forget("everything"))),y.appendChild(T);const S=t("div","parle-forget");S.appendChild(t("p","parle-says",b.lookupRecord.says)),S.appendChild(w("parle-action",b.lookupRecord.action,()=>o.forget("lookup-record"))),y.appendChild(S),y.appendChild(t("p","parle-says parle-quiet",b.kept)),r.appendChild(y);const A=t("footer","parle-foot");A.appendChild(t("p","parle-quiet",B.version(a.artifact.version))),A.appendChild(t("p","parle-quiet",B.source)),r.appendChild(A)},W=document.createElement("style");W.textContent=me;document.head.appendChild(W);const q=document.getElementById("settings");if(q!==null){const r=Y(N.layer.pipe(K(V.layer),K(J.layer))),a=_(ce,()=>{}),o=["x"];let i=null,h=!1;const u=e=>{be(q,{settings:e,artifact:Q,compiledOut:o,onDevice:h,notice:i},d)},l=()=>{const e=globalThis.LanguageModel;e?.availability!==void 0&&e.availability().then(p=>{p==="available"&&(h=!0,g())},()=>{})},n=(e,p=null)=>{i=p,r.runPromise(F(N,y=>y.change(e))).then(y=>{a.say(ue()),u(y)},()=>{})},d={setNetwork:(e,p)=>n(y=>pe(y,e,p)),setAutomatic:e=>n(p=>de(p,e)),setEveryDiscussion:e=>n(p=>le(p,e)),setProvider:e=>n(p=>oe(p,e),e==="none"?null:c.chosen(c[e==="byok"?"byok":e==="codex"?"codex":"onDevice"].name)),setByok:e=>{if(e.apiKey!==void 0&&e.apiKey.trim()===""){i=c.byok.missing,g();return}n(p=>re(p,e),e.apiKey===void 0?null:c.byok.saved)},setCodex:e=>{if(e.token!==void 0&&e.token.trim()===""){i=c.byok.missing,g();return}n(p=>te(p,e),e.token===void 0?null:c.codex.saved)},forgetProviderKey:e=>n(p=>se(p,e),c.forgotten),addExclusion:e=>{const p=H(e);if(p===null){i=m.add.rejected,g();return}n(y=>ae(y,p),`Parle will skip ${C(p)}.`)},removeExclusion:e=>n(p=>ee(p,e),`Parle will look up ${C(e)} again.`),allowAnyway:e=>{const p=H(e);if(p===null){i=m.add.rejected,g();return}n(y=>Z(y,p),`Parle will look up ${C(p)}, even though it is on the built-in list.`)},removeAllowAnyway:e=>n(p=>ie(p,e)),resumeSite:e=>n(p=>ne(p,e),`Resumed on ${e}.`),forget:e=>{a.say(he(e)),i=b.done,g()}},g=()=>{r.runPromise(F(N,e=>e.current)).then(u,()=>{})};document.addEventListener("visibilitychange",()=>{document.visibilityState==="visible"&&g()}),g(),l()}
