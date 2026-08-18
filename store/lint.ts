#!/usr/bin/env node

/**
 * There is no linter in this repository yet, and this file exists so that fact
 * is said out loud rather than inferred from a task that quietly does nothing.
 *
 * `turbo run lint` fans out to whichever workspace packages define a `lint`
 * script. None of them do. Turbo's answer to that is "No tasks were executed",
 * exit 0 — so `pnpm check` reported a passing lint stage that had never run,
 * and CI's job was named "Types, unit tests, lint, build, package" on the same
 * evidence. A gate that cannot fail is worse than a missing one, because it is
 * counted.
 *
 * Raised in review on #9, which — with #10 — is the deferred work that would
 * actually fill this in (vendored anti-slop Oxlint rules, 15 rules at `error`).
 * Until one of those lands, this prints the truth and gets out of the way.
 *
 * Exits 0 deliberately. Failing would break `pnpm check` for a gap that is
 * known, tracked and not a regression; the point is to stop the claim, not to
 * stop the build.
 */

process.stdout.write(
  "lint: no linter is configured in this repository.\n" +
    "      `turbo run lint` matches no package, so this stage checks nothing.\n" +
    "      The deferred anti-slop Oxlint work is what fills it in — see store/RELEASE.md.\n"
)
