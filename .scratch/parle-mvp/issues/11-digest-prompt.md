# What is the Digest prompt, and what shape is its output?

Type: grilling
Status: open
Blocked by: 04, 10

## Question

Blocked on ticket 04 (which Provider and what it can do) and ticket 10 (what we have selected to feed it).

[ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) is the binding constraint: the Digest synthesizes, and it may flag a claim contested **only when a specific Discussion evidences it and is linked**. Unciteable output is a bug, not a stylistic problem. That has to be engineered into the prompt and the output schema, not requested politely in prose.

- **Output schema.** A structured shape where every assertion carries a reference to the Discussion and comment it came from, so the renderer can enforce citations rather than trusting them. What happens to an assertion whose citation doesn't resolve — dropped, or shown unattributed?
- **Input selection.** Which comments actually go in? A large Reddit thread will not fit, and top-by-score systematically over-represents consensus and buries the strongest objection — which is the thing most worth reading.
- **What a good Digest contains.** Positions, the disagreement, the strongest counterargument, notable dissent. How long? What does it do when the Discussions are entirely unsubstantive, which is common?
- **The contested flag.** How is it phrased so it doesn't read as "false" ([ADR 0006](../../../docs/adr/0006-the-digest-reports-it-does-not-adjudicate.md) flags this specifically)? What is the bar for flagging at all?
- **Model variance.** The prompt must work across Codex OAuth's models, an arbitrary BYOK model, and Chrome's on-device Summarizer — which differ enormously in capability. Does the schema hold on the weakest of them, or is the Digest simply unavailable there?

**The decision:** the prompt, the output schema, and the input selection strategy. Evaluation is deliberately out of scope here — see the map's fog.
