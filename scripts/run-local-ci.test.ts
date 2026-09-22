import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

// Execute the real entrypoint, intercepting only the child launch. No Docker,
// 1Password, credentials, or remote cache traffic is needed for this contract.
const probe = (overrides: Record<string, string>) => {
  const env = { ...process.env }
  for (const key of ["TURBO_API", "TURBO_TEAM", "TURBO_TOKEN", "TURBO_CACHE", "PARLE_ALLOW_UNCACHED_CI"]) delete env[key]
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import child from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    child.spawnSync = (_cmd, args, options) => {
      console.log(JSON.stringify({ args, cache: options.env.TURBO_CACHE }));
      return { status: 0 };
    };
    syncBuiltinESMExports();
    process.argv.push('--turbo-env-loaded');
    await import('./scripts/run-local-ci.ts');
  `], { cwd: new URL("..", import.meta.url), env: { ...env, ...overrides }, encoding: "utf8" })
}

for (const [name, env, api, cache] of [
  ["default provider", { TURBO_TOKEN: "fake-test-token" }, "https://vercel.com/api", undefined],
  ["explicit uncached", { PARLE_ALLOW_UNCACHED_CI: "1" }, "https://vercel.com/api", "local:rw"],
  ["custom provider", { TURBO_TOKEN: "fake-test-token", TURBO_API: "https://cache.example.test", TURBO_TEAM: "parle" }, "https://cache.example.test", undefined]
] as const) {
  test(`${name} passes a nonempty API to Local CI`, () => {
    const result = probe(env)
    assert.equal(result.status, 0, result.stderr)
    const launch = JSON.parse(result.stdout)
    assert.ok(launch.args.includes(`TURBO_API=${api}`), result.stdout)
    assert.equal(launch.cache, cache)
    assert.ok(!result.stdout.includes("fake-test-token"))
    if (name === "custom provider") assert.ok(launch.args.includes("TURBO_TEAM=parle"))
  })
}

for (const api of ["http://127.0.0.1:8080", "http://localhost:8080", "http://[::1]:8080"]) {
  test(`rejects container-unreachable ${api}`, () => {
    const result = probe({ TURBO_TOKEN: "fake-test-token", TURBO_API: api, TURBO_TEAM: "parle" })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /cannot reach the host's loopback cache/)
    assert.equal(result.stdout, "")
  })
}
