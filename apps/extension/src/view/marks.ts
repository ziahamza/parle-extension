/**
 * The small marks Parle draws for itself and for the Networks it reads.
 *
 * Built node by node — no font, no image, no request — for the same reason the
 * speech-bubble glyph always was: a page with Trusted Types enforced refuses
 * `innerHTML` even from a content script, and this has to stay legible on pages
 * we have never seen.
 *
 * The Network marks are deliberate simplifications rather than lifted brand
 * assets: an orange square with a Y, an orangered disc with a recognisable
 * silhouette, a black X. Enough for a reader who already knows those places to
 * recognise them at 16px; not a second copy of anyone's trademark kit.
 *
 * Kept free of Effect and of `@parle/domain` so the injected surface can import
 * it without pulling the derivation graph into every page.
 */
import type { Network } from "@parle/domain/Network"

const SVG = "http://www.w3.org/2000/svg"

const svg = (viewBox: string): SVGElement => {
  const node = document.createElementNS(SVG, "svg")
  node.setAttribute("viewBox", viewBox)
  node.setAttribute("aria-hidden", "true")
  return node
}

const path = (d: string, fill?: string): SVGPathElement => {
  const node = document.createElementNS(SVG, "path")
  node.setAttribute("d", d)
  if (fill !== undefined) node.setAttribute("fill", fill)
  return node
}

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  fill: string
): SVGRectElement => {
  const node = document.createElementNS(SVG, "rect")
  node.setAttribute("x", String(x))
  node.setAttribute("y", String(y))
  node.setAttribute("width", String(width))
  node.setAttribute("height", String(height))
  node.setAttribute("rx", String(rx))
  node.setAttribute("fill", fill)
  return node
}

const circle = (cx: number, cy: number, r: number, fill: string): SVGCircleElement => {
  const node = document.createElementNS(SVG, "circle")
  node.setAttribute("cx", String(cx))
  node.setAttribute("cy", String(cy))
  node.setAttribute("r", String(r))
  node.setAttribute("fill", fill)
  return node
}

/** Parle's own speech bubble — the same path the toolbar icon and store art use. */
export const parleGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(
    path(
      "M8 1.6c-3.6 0-6.5 2.3-6.5 5.2 0 1.7 1 3.2 2.5 4.1L3.3 14l3.2-1.7c.5.1 1 .1 1.5.1 3.6 0 6.5-2.3 6.5-5.2S11.6 1.6 8 1.6z"
    )
  )
  return node
}

/** Hacker News: orange square, white Y. */
export const hackerNewsGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(rect(0, 0, 16, 16, 2.5, "#ff6600"))
  node.appendChild(
    path(
      "M4.2 3.2h1.7l2.1 4.1 2.1-4.1h1.7L8.9 8.6V12.8H7.1V8.6L4.2 3.2z",
      "#ffffff"
    )
  )
  return node
}

/**
 * Reddit: orangered disc with a white "r/" lettermark.
 *
 * A lettermark rather than the mascot — recognisable at 16px, and not a copy of
 * anyone else's character art.
 */
export const redditGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(circle(8, 8, 8, "#ff4500"))
  const label = document.createElementNS(SVG, "text")
  label.setAttribute("x", "8")
  label.setAttribute("y", "11.2")
  label.setAttribute("text-anchor", "middle")
  label.setAttribute("fill", "#ffffff")
  label.setAttribute("font-size", "7.5")
  label.setAttribute("font-weight", "700")
  label.setAttribute("font-family", "Verdana, Geneva, sans-serif")
  label.textContent = "r/"
  node.appendChild(label)
  return node
}

/** X: ink X on a near-black disc (reads on light and dark pages). */
export const xGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(circle(8, 8, 8, "#0f1419"))
  node.appendChild(
    path(
      "M4.1 4.1h2.05l1.7 2.35L10.05 4.1H12l-2.85 3.55L12.2 11.9h-2.05l-1.95-2.6-2.2 2.6H4l3.1-3.7L4.1 4.1z",
      "#ffffff"
    )
  )
  return node
}

export const networkGlyph = (network: Network): SVGElement => {
  switch (network) {
    case "hackernews":
      return hackerNewsGlyph()
    case "reddit":
      return redditGlyph()
    case "x":
      return xGlyph()
  }
}

export const NETWORK_SHORT = {
  hackernews: "HN",
  reddit: "Reddit",
  x: "X"
} satisfies Record<Network, string>

/**
 * Which Networks are speaking about this page, in a stable order.
 *
 * Order is the product's own: Hacker News, Reddit, then X — not by loudness.
 * The stack is a map of *where*, and a map that reorders itself every time a
 * louder thread lands is one the eye cannot learn.
 */
export const networksOn = (
  rows: ReadonlyArray<{ readonly network: Network }>
): ReadonlyArray<Network> => {
  const seen = new Set<Network>()
  for (const row of rows) seen.add(row.network)
  return (["hackernews", "reddit", "x"] as const).filter((network) => seen.has(network))
}

/**
 * The on-page mark's face: stacked Network discs, with Parle's bubble only when
 * nobody has a Network face to show (should not happen on a drawn mark).
 *
 * One Network → one disc. Two or three → a short overlapping stack, so the
 * corner of the page says "there is chatter, and here is where" before the
 * reader opens anything.
 */
export const stackFace = (networks: ReadonlyArray<Network>): HTMLElement => {
  const face = document.createElement("span")
  face.className = "parle-stack"
  face.dataset.count = String(Math.max(networks.length, 1))
  if (networks.length === 0) {
    const sole = document.createElement("span")
    sole.className = "parle-stack-disc parle-stack-parle"
    sole.appendChild(parleGlyph())
    face.appendChild(sole)
    return face
  }
  // Drawn back-to-front so the first Network in product order sits on top of
  // the stack (rightmost), which is what the eye reads first at a glance.
  for (const network of [...networks].reverse()) {
    const disc = document.createElement("span")
    disc.className = `parle-stack-disc parle-stack-${network}`
    disc.appendChild(networkGlyph(network))
    face.appendChild(disc)
  }
  return face
}

/** A compact Network mark for a conversation tab / nav icon. */
export const tabMark = (network: Network): HTMLElement => {
  const mark = document.createElement("span")
  mark.className = `parle-tab-mark parle-tab-mark-${network}`
  mark.appendChild(networkGlyph(network))
  return mark
}

/** Summary dock icon — a quiet sparkle until Digest becomes the default tab. */
export const summaryGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(path("M8 1.2c.35 3.75 2.05 5.45 5.8 5.8-3.75.35-5.45 2.05-5.8 5.8C7.65 9.05 5.95 7.35 2.2 7 5.95 6.65 7.65 4.95 8 1.2z", "currentColor"))
  node.appendChild(path("M13 10.4c.12 1.35.75 1.98 2.1 2.1-1.35.12-1.98.75-2.1 2.1-.12-1.35-.75-1.98-2.1-2.1 1.35-.12 1.98-.75 2.1-2.1z", "currentColor"))
  return node
}

/** Settings gear for the compact bottom nav. */
export const settingsGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  const teeth = path(
    "M6.4 1.8h3.2l.4 1.5 1.4-.5 1.6 1.6-.5 1.4 1.5.4v3.2l-1.5.4.5 1.4-1.6 1.6-1.4-.5-.4 1.5H6.4l-.4-1.5-1.4.5-1.6-1.6.5-1.4L1.8 9.6V6.4l1.5-.4-.5-1.4 1.6-1.6 1.4.5.4-1.5z"
  )
  teeth.setAttribute("fill", "none")
  teeth.setAttribute("stroke", "currentColor")
  teeth.setAttribute("stroke-width", "1.2")
  teeth.setAttribute("stroke-linejoin", "round")
  node.appendChild(teeth)
  const hub = circle(8, 8, 2, "none")
  hub.setAttribute("stroke", "currentColor")
  hub.setAttribute("stroke-width", "1.2")
  node.appendChild(hub)
  return node
}

/** Open the selected Discussion outside the compact panel. */
export const externalGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  const box = path("M6.2 3.2H3.8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.8")
  box.setAttribute("fill", "none")
  box.setAttribute("stroke", "currentColor")
  box.setAttribute("stroke-width", "1.3")
  box.setAttribute("stroke-linecap", "round")
  box.setAttribute("stroke-linejoin", "round")
  node.appendChild(box)
  const arrow = path("M8.2 2.8h5v5M13.1 2.9 7.4 8.6")
  arrow.setAttribute("fill", "none")
  arrow.setAttribute("stroke", "currentColor")
  arrow.setAttribute("stroke-width", "1.3")
  arrow.setAttribute("stroke-linecap", "round")
  arrow.setAttribute("stroke-linejoin", "round")
  node.appendChild(arrow)
  return node
}

/** Pause automatic lookups on the current site from the bottom utility dock. */
export const pauseGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(rect(4, 3, 2.5, 10, 1, "currentColor"))
  node.appendChild(rect(9.5, 3, 2.5, 10, 1, "currentColor"))
  return node
}

/** Resume automatic lookups after a site was paused. */
export const resumeGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(path("M5 3.1v9.8L13 8 5 3.1z", "currentColor"))
  return node
}

/** Nested-comment mode: three compact offset lines. */
export const nestedGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  const lines = path("M2.5 4h8M2.5 7h10.5M5.5 10h7.5M5.5 13h5")
  lines.setAttribute("fill", "none")
  lines.setAttribute("stroke", "currentColor")
  lines.setAttribute("stroke-width", "1.3")
  lines.setAttribute("stroke-linecap", "round")
  node.appendChild(lines)
  return node
}

/** Overflow menu: three dots, used for low-frequency page actions. */
export const moreGlyph = (): SVGElement => {
  const node = svg("0 0 16 16")
  node.appendChild(circle(3.5, 8, 1, "currentColor"))
  node.appendChild(circle(8, 8, 1, "currentColor"))
  node.appendChild(circle(12.5, 8, 1, "currentColor"))
  return node
}
