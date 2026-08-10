/**
 * QUESTION 4, as a library — reading a CLOSED shadow root through Steel.
 *
 * A near-verbatim port of `apps/extension/e2e/harness.ts`'s `pillPanel` and
 * `trustedClick`. Deliberately verbatim: the point is to find out whether the
 * technique our 56 checks depend on survives being run against Steel's browser,
 * not whether some other technique could be invented. `pill.content.ts` uses
 * `mode: "closed"` on purpose, so Playwright selectors cannot pierce it and an
 * init script cannot either; the only route is CDP's
 * `DOM.getDocument({ pierce: true })`, which returns closed roots because
 * DevTools has to be able to show them, plus `DOM.resolveNode` to get a handle
 * to call methods on.
 *
 * The only change from the original is where the CDP session comes from —
 * `page.context().newCDPSession(page)` on a context Playwright obtained via
 * `connectOverCDP` rather than via `launchPersistentContext`. Whether that one
 * difference matters is exactly what is being measured.
 */

export const pillPanel = async (page) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("DOM.enable")
  await cdp.send("Runtime.enable")

  const shadowRoots = async () => {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true })
    const found = []
    const walk = (node) => {
      for (const shadow of node.shadowRoots ?? []) {
        found.push(shadow.backendNodeId)
        walk(shadow)
      }
      for (const child of node.children ?? []) walk(child)
      if (node.contentDocument !== undefined) walk(node.contentDocument)
    }
    walk(root)
    return found
  }

  const inEach = async (body, args, empty) => {
    for (const backendNodeId of await shadowRoots()) {
      const resolved = await cdp.send("DOM.resolveNode", { backendNodeId }).catch(() => null)
      const objectId = resolved?.object?.objectId
      if (objectId === undefined) continue
      const answer = await cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: body,
        arguments: args.map((value) => ({ value })),
        returnByValue: true
      }).catch(() => null)
      const value = answer?.result?.value
      if (value !== undefined && value !== null && value !== empty) return value
    }
    return empty
  }

  return {
    roots: async () => (await shadowRoots()).length,
    text: () =>
      inEach(
        `function () { const d = this.querySelector(".parle-dock"); return d === null ? "" : d.innerText }`,
        [],
        ""
      ),
    count: (selector) =>
      inEach(`function (s) { return this.querySelectorAll(s).length }`, [selector], 0),
    textOf: (selector) =>
      inEach(
        `function (s) { const e = this.querySelector(s); return e === null ? "" : e.textContent }`,
        [selector],
        ""
      ),
    styleOf: (selector, property) =>
      inEach(
        `function (s, p) { const e = this.querySelector(s); return e === null ? "" : getComputedStyle(e).getPropertyValue(p) }`,
        [selector, property],
        ""
      ),
    click: (selector) =>
      inEach(
        `function (s) { const e = this.querySelector(s); if (e === null) return false; e.click(); return true }`,
        [selector],
        false
      ),
    boxOf: (selector) =>
      inEach(
        `function (s) { const e = this.querySelector(s); if (e === null) return null;` +
          ` const r = e.getBoundingClientRect();` +
          ` return { x: r.x, y: r.y, width: r.width, height: r.height } }`,
        [selector],
        null
      ),
    attribute: (selector, name) =>
      inEach(
        `function (s, a) { const e = this.querySelector(s); return e === null ? null : e.getAttribute(a) }`,
        [selector, name],
        null
      )
  }
}

/** Real mouse input at an element inside the closed root — the gesture source. */
export const trustedClick = async (page, pill, selector) => {
  const box = await pill.boxOf(selector)
  if (box === null || box.width === 0) return false
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return true
}
