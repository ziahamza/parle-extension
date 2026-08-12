/**
 * What the Provider is asked, and the shape it is asked to answer in.
 *
 * ADR 0006's consequence is quoted almost verbatim in the instruction below:
 * this is EXTRACTION WITH ATTRIBUTION, not free generation. The model is not
 * being asked what it knows about the Subject; it is being asked what these
 * Discussions said about it, and a sentence it cannot point at is a sentence it
 * must not write. That is a property we then enforce rather than trust — every
 * object comes back through `admit`, which cannot even be run without the Brief
 * — but the prompt has to ask for it, because a model asked to summarise a page
 * and handed some comments will summarise the page.
 *
 * Two pieces of the wording are load-bearing rather than stylistic:
 *
 *   - **`contested` is defined by evidence, not by belief.** ADR 0006 permits
 *     the flag only when a cited Discussion evidences it, never from the model's
 *     own knowledge, so the instruction says exactly that and says it twice.
 *     It also has to ask for the comment id, not merely permit it: the comment
 *     pointer is the only part of a Citation a model cannot produce without
 *     having read the material, so a contested flag that cites a whole thread
 *     carries the least evidence of anything in the Digest while making the
 *     product's strongest claim. {@link ./Digests.ts} discards those; the
 *     instruction says so rather than letting the model discover it.
 *   - **`contested` is defined against being read as "false".** ADR 0006 records
 *     that most people read "contested" as "this is wrong", and requires the
 *     copy to work against that. The model is told, in the same breath, that it
 *     is not being asked whether the claim is true — otherwise it quietly starts
 *     answering the question it was not asked and the flag becomes a verdict.
 *
 * The output shape is one JSON object per line, and the schema is written out by
 * hand as a single example line. That is small enough for the weakest Provider
 * ADR 0004 supports to hold, and it avoids `Schema.toJsonSchemaDocument`, which
 * would drag the JSON Schema machinery into the extension bundle to produce
 * something larger and harder for a small model to follow.
 */
import { discussionKey } from "@parle/domain/Network"
import { Turn } from "@parle/provider/Provider"
import type { Brief, Selected } from "./Brief.ts"

/** The one line the Provider is asked to repeat, once per Finding. */
export const findingLine =
  `{"statement": "...", "contested": false, "citations": [{"discussion": {"network": "...", "nativeId": "..."}, "comment": "..."}]}`

/** How many Findings a Digest asks for. Enough to have said something, few enough to check. */
const askForAtLeast = 3
const askForAtMost = 8

export const instruction = [
  "You are reporting what people said in online discussions about one web page.",
  "",
  "You will be given DISCUSSIONs. Each names a network and a nativeId. Each COMMENT inside one names an id.",
  "",
  "Reply with FINDINGS: one JSON object per line, nothing else. No prose, no markdown fences, no wrapping array, no trailing commentary. This is the exact shape:",
  "",
  findingLine,
  "",
  "statement — one sentence saying what these discussions said. In your own words, but about them, not about the subject. Do not summarise the page. Do not add what you happen to know.",
  "",
  "citations — at least one, and copy network, nativeId and comment id EXACTLY as they were given to you. Never invent one, never adjust one, never cite a discussion or a comment that is not above. A finding you cannot cite is a finding you must not write; drop it and write a different one. Cite the particular COMMENT whenever one comment is what you are reporting; leave the comment out only when you are describing the discussion as a whole.",
  "",
  "contested — true only when a comment you are citing disputes a claim the page makes. It means \"someone in these discussions disputes this\". It does not mean the claim is false, and you are not being asked whether it is false. If nobody here disputed it, contested is false, however wrong you may believe the claim to be. When contested is true you MUST cite the id of the comment that disputes it, so the reader can go and read the objection themselves; a contested finding pointing only at a whole discussion will be discarded.",
  "",
  "Report the disagreement as well as the agreement. Where the discussions split, say so and cite both sides. Where one comment makes the strongest objection, that is worth a finding of its own even if it was unpopular.",
  "",
  `Write between ${askForAtLeast} and ${askForAtMost} findings, then stop.`
].join("\n")

const numberOrUnknown = (value: number | null): string => value === null ? "unknown" : `${value}`

/**
 * One Discussion, rendered so that every identifier the model must copy back is
 * on screen, spelled the way a Citation spells it.
 *
 * `discussionKey` is included as a human label only; the machine-readable pair
 * is `network` and `nativeId`, because that is what a Citation carries and a
 * model given one form and asked for another will invent the translation.
 */
const renderSelected = (selected: Selected): string =>
  [
    `DISCUSSION ${discussionKey(selected.discussion)}`,
    `  network: ${selected.discussion.network}`,
    `  nativeId: ${selected.discussion.nativeId}`,
    `  title: ${selected.title}`,
    `  score: ${numberOrUnknown(selected.score)}`,
    `  comments: ${numberOrUnknown(selected.commentCount)}`,
    ...selected.comments.map((comment) =>
      [
        `  COMMENT id: ${comment.id}`,
        `    author: ${comment.author ?? "unknown"}`,
        `    score: ${numberOrUnknown(comment.score)}`,
        `    text: ${comment.text.replaceAll("\n", "\n      ")}`
      ].join("\n")
    )
  ].join("\n")

/** The Brief, as the Provider sees it. */
export const render = (brief: Brief): string =>
  [
    `SUBJECT: ${brief.subject}`,
    "",
    ...brief.selected.map(renderSelected)
  ].join("\n\n")

/**
 * The exchange one Digest is written from.
 *
 * Instruction and material are separate Turns rather than one concatenated
 * blob: the three Provider implementations put an instruction Turn in three
 * different places on the wire, and flattening them here would make the Digest
 * quietly better on whichever one we happened to test.
 */
export const turnsFor = (brief: Brief): ReadonlyArray<Turn> => [
  Turn.make({ speaker: "instruction", text: instruction }),
  Turn.make({ speaker: "reader", text: render(brief) })
]
