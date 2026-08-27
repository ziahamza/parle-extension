# Continuous integration

GitHub Actions is the merge authority. Local CI is a dirty-Worktree preflight
for trusted agents on `hzia-box-eu`. Both paths run the same Turbo tasks and use
the GitStart Vercel Remote Cache.

## Commands

- `pnpm check` runs affected type checks and unit tests.
- `pnpm ci:quality` runs the full deterministic quality, build, ZIP, and package
  audit graph.
- `AI_AGENT=1 pnpm ci:local` runs the three Linux CI jobs in disposable
  containers.
- `pnpm e2e` runs the 74-check real Chrome suite.
- `pnpm e2e:torture` runs the 48-check adversarial Chrome suite.

Local CI runs two jobs at a time. It builds one dependency snapshot before the
jobs start, then reuses that snapshot in isolated containers. Its state lives
under `$XDG_CACHE_HOME/parle-local-ci`, so all Parle Worktrees owned by the same
OS user share it.

## Cache credentials

Never put `TURBO_TOKEN` in Git or copy it into each Worktree. Local CI accepts a
token from the current process. When that variable is absent, the launcher
looks for this machine-level file:

```text
$XDG_CONFIG_HOME/gitstart/turbo.env
```

Use `~/.config` when `XDG_CONFIG_HOME` is not set. The file contains references,
not the token:

```dotenv
TURBO_TEAM=gitstart
TURBO_TOKEN=op://GitStart/Vercel Turbo Remote Cache/token
```

Set its mode to `0600`. The launcher uses `op run`, so 1Password exposes the
token only to the Local CI process and its containers. A direct `TURBO_TOKEN`
takes precedence. If neither source is available, Local CI stops instead of
quietly running the full graph without the shared cache. Set
`PARLE_ALLOW_UNCACHED_CI=1` only when that cost is intentional.

GitHub Actions reads the repository secret named `TURBO_TOKEN`. Pull requests
that cannot read repository secrets still run every check with Turbo's
runner-local cache. They do not write to the shared cache.

## What Turbo caches

Turbo hashes source files, package manifests, TypeScript and tool configs,
lockfile dependency versions, relevant environment variables, and upstream
package builds. A test-only edit does not invalidate a package build. A site
edit does not invalidate the extension. Chrome and Safari artifacts have
separate outputs, so one target cannot restore stale files into the other.

Successful package builds, type checks, unit tests, the Chrome ZIP audit, and
the 48-check torture suite can move between GitHub and Local CI. Turbo keeps
successful logs quiet and replays errors. GitHub's cache stores pnpm downloads
and the lockfile-pinned Playwright browser outside Turbo. It also stores each
job's `.turbo/cache` directory under a lockfile and runtime key. That smaller
cache is the fallback for runs that cannot read the Vercel token.

## Work that always runs

The 74-check browser suite performs real Network Lookups. Turbo never caches
it. Tests selected with `PARLE_LIVE=1`, release gates, store listing checks,
screenshots against public pages, Xcode compilation, signing, notarization,
publishing, and artifact upload also run against current external state.

The torture suite routes every Network request to local Playwright handlers, so
it is deterministic and cacheable. On a warm hit, CI skips the Playwright
browser installation too. Release workflows still execute their signing,
submission, and publication steps even when deterministic inputs restore from
cache.
