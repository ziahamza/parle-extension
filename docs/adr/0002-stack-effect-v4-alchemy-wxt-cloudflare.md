# Stack: Effect v4 beta, Alchemy, WXT, Cloudflare, pnpm + Turborepo monorepo

The project is built on Effect v4 (beta) as the core runtime and effect system, WXT as the extension framework (typed over with Effect rather than used bare), Alchemy v2 (beta) for infrastructure-as-code, and Cloudflare as the deployment target — mostly static artifacts on a CDN, with a small number of public APIs. Everything is a pnpm workspace monorepo orchestrated by Turborepo.

## Considered Options

Not a comparison-driven choice. Effect v4 was picked for its rewritten, smaller core (~20 kB vs ~70 kB for a minimal program) and its consolidated single-package ecosystem, which matters in an extension bundle. Alchemy was picked over Terraform/Wrangler-config for typed, code-first IaC in the same language as the rest of the repo.

## Consequences

- **Both Effect v4 and Alchemy are betas.** Effect's own release notes state v4 is not recommended for production and that breaking changes will land across beta releases. Upgrade churn is an accepted, ongoing cost; pin exact versions and treat an Effect upgrade as a scheduled task, not a background chore.
- Effect v4 moved `@effect/platform` and `@effect/rpc` into the main `effect` package, and puts newer APIs under `effect/unstable/*` without semver guarantees. Anything imported from `unstable` is a known future migration.
- WXT defaults to MV2 for Safari and Firefox and MV3 elsewhere. Supporting both manifest versions means two background models (persistent/event page vs terminating service worker), so the background layer must be written against our own abstraction, not against `chrome.*` directly.
- The backend is **replaceable, not absent**: the artifact-build and API code is open source and the extension's backend origin is user-configurable, so anyone can deploy the whole thing to their own Cloudflare account and point their install at it. This, not "we run no servers", is the form the no-lock-in promise takes.
