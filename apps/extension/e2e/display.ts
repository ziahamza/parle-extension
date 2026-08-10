/**
 * One Xvfb per shard, on a display number this process chose and verified.
 *
 * This replaces `xvfb-run -a` wherever more than one harness runs at once,
 * because `-a` is a measured loss at scale: at 24 concurrent launches it lost
 * runs to a display-allocation race — two `xvfb-run -a` instances pick the same
 * free number, one Xvfb wins the lock, and the loser's Chrome dies with
 * "Missing X server or $DISPLAY" (`spike/steel/out/parallel-local-24/run-3.log`).
 * That was the only failure mode the local harness showed at any N, so it is
 * fixed here rather than retried around.
 *
 * The allocation is honest about its own race. The `/tmp/.X<N>-lock` +
 * `/tmp/.X11-unix/X<N>` pre-check only skips numbers that are *known* taken; the
 * real arbiter is Xvfb itself, whose display lock is atomic. So: spawn Xvfb on
 * the candidate number and wait for whichever comes first —
 *
 *   - the display socket appears and the process is still alive: we own it;
 *   - the process exits ("Server is already active for display N"): somebody
 *     else got there between the check and the spawn, try the next number.
 *
 * Losing the race costs one retry instead of one run, which is the whole fix.
 * Callers hand each shard a distinct `preferred` number so the common case
 * never races at all.
 */
import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"

export interface OwnedDisplay {
  /** The display number that was actually won, e.g. 121. */
  readonly number: number
  /** What goes in the child's DISPLAY, e.g. ":121". */
  readonly name: string
  readonly stop: () => Promise<void>
}

const socketOf = (n: number) => `/tmp/.X11-unix/X${n}`
const lockOf = (n: number) => `/tmp/.X${n}-lock`

/** Does anything on this box already hold display :n? Best effort only. */
const looksTaken = (n: number): boolean => fs.existsSync(lockOf(n)) || fs.existsSync(socketOf(n))

/**
 * Spawn Xvfb on :n and report whether we won it.
 *
 * "Won" is both conditions at once: the socket exists AND the process is still
 * running. A socket left behind by a dead server is not a display, and a
 * process that has not made its socket yet is not ready — Chrome launched
 * against either one dies exactly the way the `-a` race killed it.
 */
const tryDisplay = (n: number, screen: string): Promise<ChildProcess | null> =>
  new Promise((resolve) => {
    const child = spawn("Xvfb", [`:${n}`, "-screen", "0", screen, "-nolisten", "tcp"], {
      stdio: "ignore"
    })
    let settled = false
    const settle = (winner: ChildProcess | null) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(giveUp)
      resolve(winner)
    }
    child.once("exit", () => settle(null))
    const poll = setInterval(() => {
      if (fs.existsSync(socketOf(n)) && child.exitCode === null) settle(child)
    }, 50)
    // Ten seconds is geologic time for Xvfb to make a socket. Not winning by
    // then means something is wrong with this number; spend a retry, not a run.
    const giveUp = setTimeout(() => {
      child.kill("SIGTERM")
      settle(null)
    }, 10_000)
  })

/**
 * Own a display at or above `preferred`, verified live before it is returned.
 */
export const acquireDisplay = async (
  preferred: number,
  options: { readonly screen?: string; readonly tries?: number } = {}
): Promise<OwnedDisplay> => {
  const screen = options.screen ?? "1280x900x24"
  const tries = options.tries ?? 200
  for (let offset = 0; offset < tries; offset += 1) {
    const n = preferred + offset
    if (looksTaken(n)) continue
    const child = await tryDisplay(n, screen)
    if (child === null) continue
    return {
      number: n,
      name: `:${n}`,
      stop: () =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve()
          child.once("exit", () => resolve())
          child.kill("SIGTERM")
          // Xvfb ignores nothing, but a stuck one must not hang the run's exit.
          setTimeout(() => {
            child.kill("SIGKILL")
            resolve()
          }, 5_000).unref()
        })
    }
  }
  throw new Error(`no free X display in [:${preferred}, :${preferred + tries})`)
}
