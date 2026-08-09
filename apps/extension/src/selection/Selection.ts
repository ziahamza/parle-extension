/**
 * Text selection, anchored so it can survive the page changing underneath it.
 *
 * Nothing in v1 uses this. It is here because ADR 0008 says so, and the reason
 * it gives is specific: the selection-to-anchor mapping is the hardest part of
 * the fact-check half and the part most damaged by being added late. Retrofitted
 * onto a shipped content script, it becomes a second pass over the DOM by
 * whoever owns the panel; built now, it is where selection already lives.
 *
 * The anchor is a text quote — exact text plus a short prefix and suffix —
 * rather than an XPath or a node offset. That choice is the whole point. A
 * single-page app re-renders its article body on navigation and on hydration,
 * and every node-identity anchor dies at that moment while a quote survives it;
 * a quote also survives being re-found after the reader scrolls back, and can be
 * carried into a Brief, which a DOM path cannot.
 *
 * `resolve` is the proof the shape works: an anchor taken before a mutation
 * still finds its text after one. It exists to be tested, not because v1 calls
 * it.
 */

/** Enough surrounding text to disambiguate a repeated phrase. */
const CONTEXT = 32

export interface Anchor {
  readonly exact: string
  readonly prefix: string
  readonly suffix: string
  /** Where it was, in characters, when taken. A hint for re-finding, not identity. */
  readonly wasAt: number
}

/** Where an anchor resolves to now, in the current text. `-1` when it is gone. */
export const resolve = (text: string, anchor: Anchor): number => {
  if (anchor.exact === "") return -1

  // Prefer an occurrence whose context still matches: that is what makes a
  // phrase appearing four times on the page resolve to the right one.
  const withContext = `${anchor.prefix}${anchor.exact}${anchor.suffix}`
  const contextual = text.indexOf(withContext)
  if (contextual !== -1) return contextual + anchor.prefix.length

  // Otherwise the nearest bare occurrence to where it used to be. The page
  // changed around it; the quote is still the best claim we have.
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let at = text.indexOf(anchor.exact)
  while (at !== -1) {
    const distance = Math.abs(at - anchor.wasAt)
    if (distance < bestDistance) {
      best = at
      bestDistance = distance
    }
    at = text.indexOf(anchor.exact, at + 1)
  }
  return best
}

/** Take an anchor from a selection over `text`. Null when there is nothing to take. */
export const anchorAt = (text: string, start: number, end: number): Anchor | null => {
  if (end <= start) return null
  const exact = text.slice(start, end)
  if (exact.trim() === "") return null
  return {
    exact,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    wasAt: start
  }
}

/**
 * Watch what the reader has selected in this document.
 *
 * Returns the function that stops watching, because a content script outlives
 * several page states and a listener nobody removes is the ordinary way a
 * single-page app ends up with forty of them.
 */
export const watchSelection = (
  onAnchor: (anchor: Anchor | null) => void
): (() => void) => {
  const take = (): void => {
    const selection = document.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      onAnchor(null)
      return
    }
    const exact = selection.toString()
    const text = document.body.textContent ?? ""
    const start = text.indexOf(exact)
    onAnchor(start === -1 ? { exact, prefix: "", suffix: "", wasAt: 0 } : anchorAt(text, start, start + exact.length))
  }

  document.addEventListener("selectionchange", take, { passive: true })
  return () => document.removeEventListener("selectionchange", take)
}
