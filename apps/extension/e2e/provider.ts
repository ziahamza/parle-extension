/**
 * A Provider the reader could plausibly have connected, running on this machine.
 *
 * The Digest is the one path in the product that spends somebody's money, so it
 * is also the one path nobody wants to exercise against a real endpoint on every
 * run. What is NOT substituted here is anything of ours: the extension reaches
 * this over its own paced `HttpClient`, from the real service worker, through
 * the real `Byok` layer, carrying the real key out of the real settings
 * document, and the answer comes back as real `chat/completions` SSE. `baseUrl`
 * is a setting precisely so that "an OpenAI-compatible endpoint of your own" is
 * a supported configuration rather than a test seam — a reader running a local
 * model has exactly this arrangement.
 *
 * **It answers out of the prompt it was given, and that is the point.** A stub
 * with a hard-coded comment id would go stale the day Hacker News edits a thread
 * and would prove nothing about whether the ids the extension put in front of
 * the model are the ids it will accept back. So this reads the `DISCUSSION` and
 * the first `COMMENT id:` out of the Brief it actually received and cites those
 * — and then, deliberately, cites one that was never there.
 */
import * as http from "node:http"
import type { AddressInfo } from "node:net"

export interface StubProvider {
  readonly baseUrl: string
  /** Every `Authorization` header the extension sent. */
  readonly authorizations: ReadonlyArray<string>
  /** Every prompt body the extension sent, as text. */
  readonly prompts: ReadonlyArray<string>
  readonly close: () => Promise<void>
}

/** One `data:` frame of an OpenAI-compatible stream. */
const frame = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

/**
 * The turns of one `chat/completions` request, as text.
 *
 * Read out of the JSON rather than off the raw body, because the body is JSON:
 * every newline in the rendered Brief arrives as the two characters `\` and `n`,
 * so a line-anchored pattern run against the wire bytes matches nothing at all.
 */
const turnsOf = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as {
      messages?: ReadonlyArray<{ readonly content?: unknown }>
    }
    return (parsed.messages ?? [])
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n")
  } catch {
    return ""
  }
}

/**
 * The (network, nativeId) and first comment id in a rendered Brief.
 *
 * `Prompt.ts` writes them as `  network: …`, `  nativeId: …` and
 * `  COMMENT id: …`, one per line, which is the shape a small model is expected
 * to be able to copy back. Reading them the same way is what makes this stub a
 * model that read the material rather than one that was told the answer.
 */
const citedFrom = (prompt: string): {
  readonly network: string
  readonly nativeId: string
  readonly comment: string
} | null => {
  const network = /^\s*network:\s*(\S+)$/m.exec(prompt)?.[1]
  const nativeId = /^\s*nativeId:\s*(\S+)$/m.exec(prompt)?.[1]
  const comment = /^\s*COMMENT id:\s*(\S+)$/m.exec(prompt)?.[1]
  if (network === undefined || nativeId === undefined || comment === undefined) return null
  return { network, nativeId, comment }
}

export const startProvider = async (): Promise<StubProvider> => {
  const authorizations: Array<string> = []
  const prompts: Array<string> = []

  const server = http.createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      authorizations.push(request.headers.authorization ?? "")
      prompts.push(body)

      const cited = citedFrom(turnsOf(body))
      if (cited === null) {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { message: "no Brief in that request" } }))
        return
      }

      const lines = [
        // Real, and pointing at a comment that was in front of it.
        JSON.stringify({
          statement: "Commenters argued the licence is what decides whether a model is open.",
          contested: false,
          citations: [{
            discussion: { network: cited.network, nativeId: cited.nativeId },
            comment: cited.comment
          }]
        }),
        // Invented, and inventing the source for it too — the exact shape ADR
        // 0006 exists for. It must not reach the screen, and its absence must
        // cost the reader the good one above.
        JSON.stringify({
          statement: "A study nobody in these discussions mentioned found the opposite.",
          contested: true,
          citations: [{
            discussion: { network: "hackernews", nativeId: "999999999" },
            comment: "999999999"
          }]
        })
      ]

      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        // The service worker's origin is `chrome-extension://…`. Host
        // permissions cover the request; this covers the response.
        "access-control-allow-origin": "*"
      })
      for (const line of lines) response.write(frame(`${line}\n`))
      response.write("data: [DONE]\n\n")
      response.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    authorizations,
    prompts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
