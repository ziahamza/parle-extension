/**
 * A surface's end of the wire, with the reconnect MV3 makes mandatory.
 *
 * The background's service worker is killed after a short idle and restarted on
 * demand. A panel left open across that gap loses its port and, without this,
 * would sit showing a frame from before the worker died — stale, with nothing
 * on screen saying so. So the link reconnects and *replays its standing Ask*;
 * and because what comes back is whole state rather than a delta, the reconnect
 * is invisible, since the first frame after it is simply correct.
 *
 * This file is deliberately free of Effect and of `@parle/domain`. It is what
 * gets injected into every page that has something to show, and ADR 0003 makes
 * iOS the constraining platform — the runtime belongs in the background, where
 * it is loaded once, not in the script that lands on the reader's page.
 */
import { browser } from "wxt/browser"
import { type Ask, hearWord, type Word } from "../wire/Wire.ts"
import { type Json } from "@parle/domain/Refine"

const RECONNECT_MS = 400

export interface Link {
  /**
   * Say something to the background. `standing` asks are replayed on reconnect.
   *
   * Reports whether the port took it. Every surface that sends *state* can
   * ignore that — the next frame is whole, so a dropped ask costs nothing — but
   * a surface that sends *work* cannot: harvesting a page is a thing that
   * happens once, and MV3 kills the worker underneath an open tab often enough
   * that "the port was gone for 400ms" is an ordinary event rather than an edge
   * case. A caller that must not lose it needs to be told, and only this
   * function knows.
   */
  readonly say: (ask: Ask, standing?: boolean) => boolean
  readonly close: () => void
}

export const link = (name: string, onWord: (word: Word) => void): Link => {
  let port: ReturnType<typeof browser.runtime.connect> | null = null
  let closed = false
  const standing: Array<Ask> = []

  const post = (ask: Ask): boolean => {
    if (port === null) return false
    try {
      port.postMessage(ask)
      return true
    } catch {
      // The worker went away between our check and our post. The reconnect
      // path replays anything that mattered.
      return false
    }
  }

  const attach = (): void => {
    if (closed) return
    port = browser.runtime.connect({ name })
    port.onMessage.addListener((raw: Json) => {
      const heard = hearWord(raw)
      if (heard !== null) onWord(heard)
    })
    port.onDisconnect.addListener(() => {
      port = null
      if (!closed) setTimeout(attach, RECONNECT_MS)
    })
    for (const ask of standing) post(ask)
  }

  attach()

  return {
    say: (ask, isStanding = false) => {
      if (isStanding) standing.push(ask)
      return post(ask)
    },
    close: () => {
      closed = true
      try {
        port?.disconnect()
      } catch {
        // Already gone.
      }
      port = null
    }
  }
}
