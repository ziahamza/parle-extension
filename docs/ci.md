# Continuous integration

GitHub Actions is the merge authority. Local CI is a dirty-Worktree preflight
for trusted agents on `hzia-box-eu`. Both paths run the same Turbo tasks.
Trusted main CI uses Layer Cache. Local CI keeps Vercel as its fallback; host
builds can use the installed Layer Cache daemon directly.

## Commands

- `pnpm check` runs affected type checks and unit tests.
- `pnpm ci:quality` runs the full deterministic quality, build, ZIP, and package
  audit graph.
- `AI_AGENT=1 pnpm ci:local` runs the three Linux CI jobs in disposable
  containers.
- `pnpm e2e` runs the 82-check real Chrome suite.
- `pnpm e2e:torture` runs the 48-check adversarial Chrome suite.

Local CI runs two jobs at a time. It builds one dependency snapshot before the
jobs start, then reuses that snapshot in isolated containers. Its state lives
under `$XDG_CACHE_HOME/parle-local-ci`, so all Parle Worktrees owned by the same
OS user share it.

## Cache credentials

For ordinary host builds and fresh Worktrees on `hzia-box-eu`, use the configured
Parle daemon through the Layer Cache CLI:

```bash
layercache run --config ~/.config/layercache/parle.json -- pnpm ci:quality
```

This keeps authentication and cache routing in Layer Cache, not in a project
script. The daemon must already be running and authenticated for Parle. The CLI
injects a scoped credential; never copy the protected config or token into Git.
Plain `pnpm` commands do not automatically connect to that daemon. Compatible
worktrees can reuse the same machine-level config and cache. Other machines need
their own Layer Cache setup and a matching toolchain compatibility identity.

Do not wrap `pnpm ci:local` with that host-loopback configuration: its bridged
containers cannot reach `127.0.0.1` on the host. The launcher rejects this setup
instead of sending a Layer Cache credential to Vercel. A separately configured
container-reachable route must supply `TURBO_API`, `TURBO_TEAM` and a credential
for that route. The launcher forwards the API and team as Local CI workflow
variables and the token as an existing workflow secret. This change does not
provision that network route. `.env.local-ci` secret values take precedence in
Local CI; remove an old `TURBO_TOKEN` from that file before switching providers.

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

The separate Local CI workflow's GitHub dispatch uses the repository secret named
`TURBO_TOKEN` and defaults to Vercel. Main CI uses Layer Cache's OIDC action.
Pull requests never receive a write credential, including branches in this
repository: PR-controlled code must not be able to exfiltrate a read/write
credential or poison results later restored by a release. PRs still run every
check with their branch-scoped `.turbo/cache` Actions fallback, but cannot read
or write the shared Vercel cache.

## What Turbo caches

Turbo hashes source files, package manifests, TypeScript and tool configs,
lockfile dependency versions, relevant environment variables, and upstream
package builds. A test-only edit does not invalidate a package build. A site
edit does not invalidate the extension. Chrome and Safari artifacts have
separate outputs, so one target cannot restore stale files into the other.

Successful package builds, type checks, unit tests, and the Chrome ZIP audit can
move between GitHub and Local CI. The 48-check torture task is cacheable for an
explicit developer run, but CI, Local CI, and the Chrome submission workflow
all pass Turbo's `--force` flag and install Playwright unconditionally. A cache
hit or replayed log therefore cannot satisfy a required browser gate. GitHub's
cache stores pnpm downloads and the lockfile-pinned Playwright browser outside
Turbo. It also stores each job's `.turbo/cache` directory under a lockfile and
runtime key. That smaller cache is the fallback for runs that cannot read the
remote credential.

Use the root package scripts for extension builds and browser checks. Their
typed launcher gives `hzia-box-eu` the same Linux runtime identity as GitHub
and gives other operating systems and architectures separate identities. A
direct `turbo run` can omit that identity and cause avoidable artifact misses.

## Work that always runs

The 82-check browser suite performs real Network Lookups. Turbo never caches
it. The required 48-check CI, Local CI, and release jobs also force a fresh
browser execution. Tests selected with `PARLE_LIVE=1`, store listing checks,
screenshots against public pages, Xcode compilation, signing, notarization,
publishing, and artifact upload also run against current external state.
