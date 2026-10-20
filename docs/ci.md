# Continuous integration

GitHub Actions is the merge authority. Local CI is a dirty-Worktree preflight
for trusted agents on `hzia-box-eu`. Both paths run the same Turbo tasks.
Trusted main CI and eligible same-repository PRs use LayerCache. The separate
Local CI container workflow retains its existing credential configuration; host
builds can use an enrolled LayerCache CLI configuration.

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

After dependency installation, CI and local launchers use the same measured
runtime profile:

```bash
pnpm exec node .github/layercache-runtime.mjs parle-ci-v2
```

The helper prints JSON containing `ready`, `compatibility`, and the actual
consumer Node runtime and ABI, OS/architecture, OS release and libc, pnpm, and
installed Turbo versions. Its SHA256 profile excludes source revisions,
checkout paths, elapsed time and runner job IDs. Turbo continues to hash each
task's declared inputs. Missing runtime facts disable Team setup and GitHub task
snapshot restore rather than selecting the older broad namespace. New profiles
start cold.

Ordinary Linux Turbo jobs select Ubuntu 24.04 for both trusted main and PR
validation. A floating main runner image can select another OS/libc profile and
prevent its publications from warming PR or local readers. The measured facts
still decide compatibility; Mac jobs retain their separate profile.

For ordinary host builds and fresh Worktrees, enroll the machine's Parle
configuration with that exact compatibility value, then connect a normal command
through the installed CLI:

```bash
layercache run --config ~/.config/layercache/parle.json -- pnpm ci:quality
```

This keeps authentication and cache routing in LayerCache. A cloud-only CLI
configuration can connect directly to Team without a local daemon or artifact
store. The CLI injects a scoped credential; never copy the protected config or
token into Git. Plain `pnpm` commands do not read that configuration. Existing
machine enrollment does not automatically acquire the new profile. Worktrees
with matching runtime facts can reuse the same profile; other runtimes correctly
select another namespace.

Container Local CI needs its own measured runtime and a matching scoped
credential. Do not assume that a host profile is valid in the container. Bridged
containers also cannot reach a host-loopback daemon at `127.0.0.1`; the launcher
rejects that route. A configured container-reachable API must supply `TURBO_API`,
`TURBO_TEAM` and its credential. The launcher forwards them through the existing
workflow variables and secret. This change does not complete that separate
container enrollment. `.env.local-ci` secret values take precedence; remove an
old `TURBO_TOKEN` from that file before switching providers.

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
`TURBO_TOKEN` and defaults to Vercel. Ordinary CI uses a reviewed immutable
LayerCache action at `https://layercache.services.ziahamza.com`. A trusted push to
`main` requests read-write Turbo use; same-repository PRs and ordinary manual
readers request read-only use. The service independently verifies identity and
write authority. Fork PRs do not run Team setup and retain their GitHub snapshot
fallback. All task snapshots are scoped by the same measured runtime profile.
Ordinary runtime-probe or authentication failure leaves the current task graph
running. Separate qualification still requires real remote hits.

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

Local CI passes `https://vercel.com/api` explicitly when no custom API is set:
the runner rejects empty referenced variables before starting containers. Explicit
uncached mode also supplies that required variable, but `TURBO_CACHE=local:rw`
disables all remote cache reads and writes. Launcher regression tests run with
`pnpm typecheck:tools` and intercept child execution without contacting a cache.

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
