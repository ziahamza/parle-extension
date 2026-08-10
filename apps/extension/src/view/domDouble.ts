/**
 * Just enough DOM to render a panel into and read back out. For tests only.
 *
 * Hand-written rather than `jsdom` or `happy-dom` on purpose. `render.ts` uses
 * about eight DOM calls in total — ADR 0003 makes the injected surface plain
 * `document.createElement`, precisely so it stays a few kilobytes — and pulling
 * a full DOM implementation into the toolchain to exercise eight calls is a
 * larger commitment than the thing being tested.
 *
 * It is also what makes the vocabulary test possible in the first place: the
 * whole point is to read `textContent` over a finished tree and check no
 * engineering term reached the reader, and that needs a tree, not a string.
 *
 * Nothing imports this outside a test, so it never reaches a bundle: WXT builds
 * from entrypoints, and no entrypoint can reach here.
 */

export class Fake {
  className = ""
  href = ""
  target = ""
  rel = ""
  /**
   * The real `hidden` property, modelled the way a READER experiences it.
   *
   * `Element.textContent` in a browser includes hidden subtrees; this double's
   * does not, and the divergence is deliberate. Every assertion written against
   * this class is about what somebody sees — "every state puts something on the
   * screen" is the load-bearing one — and a double whose `textContent` counted
   * a collapsed section would report a panel as non-empty while the reader
   * looked at nothing. The DOM property is the shipped mechanism; this is what
   * it means.
   */
  hidden = false
  readonly children: Array<Fake> = []
  /** Text set directly on this node, as distinct from its descendants'. */
  private own = ""
  private readonly handlers = new Map<string, Array<(event: { preventDefault: () => void }) => void>>()

  readonly tag: string

  // Written out rather than a parameter property: this repo compiles with
  // `erasableSyntaxOnly`, so a constructor parameter that declares a field is
  // syntax the type stripper cannot erase.
  constructor(tag: string) {
    this.tag = tag
  }

  /** Who this node hangs off, so `remove` can detach it. `null` at the root. */
  private parent: Fake | null = null

  appendChild(child: Fake): Fake {
    child.parent = this
    this.children.push(child)
    return child
  }

  addEventListener(
    type: string,
    handler: (event: { preventDefault: () => void }) => void
  ): void {
    const held = this.handlers.get(type) ?? []
    held.push(handler)
    this.handlers.set(type, held)
  }

  /** Everything a reader would see, in order — the whole subtree's text. */
  get textContent(): string {
    if (this.hidden) return ""
    return this.own + this.children.map((child) => child.textContent).join("")
  }

  /** Assigning replaces the children, as the real one does. */
  set textContent(text: string) {
    for (const child of this.children) child.parent = null
    this.children.length = 0
    this.own = text
  }

  /** Take this node off the tree, as `Element.remove` does. */
  remove(): void {
    const held = this.parent
    if (held === null) return
    const at = held.children.indexOf(this)
    if (at >= 0) held.children.splice(at, 1)
    this.parent = null
  }

  click(): void {
    for (const handler of this.handlers.get("click") ?? []) {
      handler({ preventDefault: () => {} })
    }
  }

  /** Every node in this subtree, this one first. Hidden nodes included. */
  all(): Array<Fake> {
    return [this as Fake, ...this.children.flatMap((child) => child.all())]
  }

  /** Every node whose class list contains `name`. */
  withClass(name: string): Array<Fake> {
    return this.all().filter((node) => node.className.split(/\s+/).includes(name))
  }

  /** The first node of this tag whose own text is exactly `text`. */
  labelled(text: string): Fake | undefined {
    return this.all().find((node) => node.textContent === text)
  }
}

/**
 * Install a document and hand back a root to draw into.
 *
 * Global because that is how `render.ts` reaches the DOM in a browser, and a
 * test that passed a document in would be exercising a seam the shipped code
 * does not have.
 */
export const mountDouble = (): Fake => {
  const made = {
    createElement: (tag: string) => new Fake(tag),
    createTextNode: (text: string) => {
      const node = new Fake("#text")
      node.textContent = text
      return node
    }
  }
  ;(globalThis as { document?: unknown }).document = made
  return new Fake("div")
}
