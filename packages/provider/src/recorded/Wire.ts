/**
 * Recorded wire captures, kept as source so the SSE decoder is tested against
 * bytes a real endpoint actually sent rather than against bytes we invented to
 * match our parser.
 *
 * The truncated captures are the important ones. Every other case in this file
 * is a sanity check; the truncated ones encode the requirement that a Provider
 * dying mid-Digest yields the Findings it already produced.
 */
import * as Encoding from "effect/Encoding"
import { type Json } from "@parle/domain/Refine"

/**
 * A JWT carrying whatever payload is asked for, signed with nothing.
 *
 * We read a claim out of the Codex token to address the request; we never
 * verify it, so a fixture needs no key. Building these rather than pasting one
 * in also means no real token is ever committed.
 */
export const jwtCarrying = (payload: Json): string =>
  [
    Encoding.encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    Encoding.encodeBase64Url(JSON.stringify(payload)),
    "not-a-real-signature"
  ].join(".")

/** A Codex access token shaped the way OpenAI issues them. */
export const codexToken = jwtCarrying({
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-9f1c",
    chatgpt_plan_type: "plus"
  },
  sub: "user-4412",
  exp: 1750003600
})

/** A token that authenticates and can spend nothing. */
export const codexTokenWithoutAccount = jwtCarrying({ sub: "user-4412", exp: 1750003600 })

/** One complete OpenAI-compatible chat.completions stream, four deltas. */
export const openAiComplete = [
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
  "",
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Commenters dispute the benchmark methodology."},"finish_reason":null}]}`,
  "",
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":" Several report the same regression on ARM."},"finish_reason":null}]}`,
  "",
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  "",
  "data: [DONE]",
  "",
  ""
].join("\n")

/**
 * The same stream, cut off in the middle of the third event's JSON.
 *
 * The first two Findings-worth of text completed. The third `data:` line has no
 * terminating blank line and its JSON is half-written — emitting it would be
 * inventing content, so it is dropped and the two complete deltas survive.
 */
export const openAiTruncated = [
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Commenters dispute the benchmark methodology."},"finish_reason":null}]}`,
  "",
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":" Several report the same regression on ARM."},"finish_reason":null}]}`,
  "",
  `data: {"id":"chatcmpl-9x","object":"chat.completion.chunk","created":1750000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":" A third point that was ne`
].join("\n")

/** A fault announced inside a 200 response, before any text arrived. */
export const openAiFaultFirst = [
  `data: {"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}`,
  "",
  ""
].join("\n")

/** An interstitial served as a 200 with an event-stream content type. */
export const openAiNotJson = [
  "data: <!DOCTYPE html><title>Just a moment...</title>",
  "",
  ""
].join("\n")

/** One complete Codex `responses` stream. */
export const codexComplete = [
  "event: response.created",
  `data: {"type":"response.created","response":{"id":"resp_01","status":"in_progress"}}`,
  "",
  "event: response.output_item.added",
  `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant"}}`,
  "",
  "event: response.output_text.delta",
  `data: {"type":"response.output_text.delta","item_id":"msg_01","output_index":0,"delta":"Commenters dispute the benchmark methodology."}`,
  "",
  "event: response.output_text.delta",
  `data: {"type":"response.output_text.delta","item_id":"msg_01","output_index":0,"delta":" Several report the same regression on ARM."}`,
  "",
  "event: response.completed",
  `data: {"type":"response.completed","response":{"id":"resp_01","status":"completed"}}`,
  "",
  ""
].join("\n")

/** The same stream, cut off mid-event after one delta had completed. */
export const codexTruncated = [
  "event: response.output_text.delta",
  `data: {"type":"response.output_text.delta","item_id":"msg_01","output_index":0,"delta":"Commenters dispute the benchmark methodology."}`,
  "",
  "event: response.output_text.delta",
  `data: {"type":"response.output_text.delta","item_id":"msg_01","output_ind`
].join("\n")

/** The endpoint accepted the request and then gave up on it. */
export const codexFailed = [
  "event: response.failed",
  `data: {"type":"response.failed","response":{"id":"resp_01","status":"failed"}}`,
  "",
  ""
].join("\n")

/**
 * A capture exercising the parts of the SSE grammar the Providers do not.
 *
 * Multi-line data, CRLF framing, a keepalive comment, a field with no space
 * after the colon, an `event:` with nothing under it, and an id we discard.
 */
export const sseGrammar = [
  ": keepalive",
  "",
  "event: named\r",
  "data: first\r",
  "data: second\r",
  "id: 7\r",
  "\r",
  "data:no-space",
  "",
  "event: lonely",
  "",
  "retry: 3000",
  "data: last",
  "",
  ""
].join("\n")
