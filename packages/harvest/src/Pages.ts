/**
 * One door for every Network page shape.
 *
 * The dispatch is on the `Network` the page declares and then on its own
 * address, because the address is the only thing that reliably distinguishes a
 * listing from a conversation and it is already trustworthy — the content
 * script read it from the frame it is running in, not from the markup.
 *
 * The `switch` is exhaustive over `Network` with no default arm on purpose:
 * adding a fourth Network to the glossary makes this file fail to compile,
 * which is the friction that stops a new Network shipping with harvesting
 * silently absent.
 */
import type { NetworkPage, PageReading } from "./Page.ts"
import * as HackerNews from "./HackerNews.ts"
import * as Reddit from "./Reddit.ts"
import * as X from "./X.ts"

export const read = (page: NetworkPage): PageReading => {
  switch (page.network) {
    case "hackernews":
      return HackerNews.read(page)
    case "reddit":
      return Reddit.read(page)
    case "x":
      return X.read(page)
  }
}
