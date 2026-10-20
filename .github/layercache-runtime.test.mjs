import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runtimeProfile } from "./layercache-runtime.mjs";

const facts = {
  platform: "linux",
  arch: "x64",
  system: { id: "ubuntu", version: "24.04", libc: "2.39" },
  node: { node: "24.13.0", v8: "13.6.233.10-node.25", modules: "137" },
  pnpm: "9.12.0",
  turbo: "2.10.9",
};

test("compatible worktrees have the same profile without source, paths or timing", () => {
  const expected = runtimeProfile("example-ci-v2", facts);
  const other = runtimeProfile("example-ci-v2", {
    ...facts,
    node: { modules: "137", v8: facts.node.v8, node: "24.13.0" },
    source: "different-commit",
    cwd: "/different/worktree",
    elapsedMs: 900,
  });
  assert.equal(other.compatibility, expected.compatibility);
  assert.match(
    expected.compatibility,
    /^example-ci-v2-linux-x64-[0-9a-f]{64}$/,
  );
  assert.equal(
    runtimeProfile("example-ci-v2", {
      ...facts,
      node: { ...facts.node, nghttp3: "" },
    }).ready,
    true,
  );
});

test("each selected runtime change isolates remote and snapshot reuse", () => {
  const expected = runtimeProfile("example-ci-v2", facts).compatibility;
  for (const changed of [
    { ...facts, arch: "arm64" },
    {
      ...facts,
      platform: "darwin",
      system: { id: "macos", version: "15.5", libc: "system" },
    },
    { ...facts, node: { ...facts.node, node: "24.14.0" } },
    { ...facts, node: { ...facts.node, modules: "138" } },
    { ...facts, system: { ...facts.system, libc: "2.40" } },
    { ...facts, pnpm: "9.13.0" },
    { ...facts, turbo: "2.10.10" },
  ])
    assert.notEqual(
      runtimeProfile("example-ci-v2", changed).compatibility,
      expected,
    );
});

test("an unsupported or incomplete identity cannot fall back to a broad profile", () => {
  for (const changed of [
    { ...facts, platform: "unknown" },
    { ...facts, arch: "unknown" },
    { ...facts, system: { ...facts.system, libc: undefined } },
    { ...facts, pnpm: "unknown" },
    { ...facts, turbo: "" },
    { ...facts, node: {} },
  ])
    assert.throws(() => runtimeProfile("example-ci-v2", changed));
  assert.throws(() => runtimeProfile("bad\ncompatibility=broad", facts));
});

test("the CLI probes the installed pnpm and Turbo, emits one profile and fixed diagnostics", () => {
  if (process.platform !== "linux") return;
  const root = mkdtempSync(join(tmpdir(), "layercache-runtime-"));
  const script = fileURLToPath(
    new URL("./layercache-runtime.mjs", import.meta.url),
  );
  try {
    const pnpm = join(root, "pnpm");
    writeFileSync(
      pnpm,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 9.12.0; else echo 2.10.9; fi\n',
      { mode: 0o700 },
    );
    const output = join(root, "output");
    const env = {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
    };
    const result = JSON.parse(
      execFileSync(process.execPath, [script, "example-ci-v2"], {
        env,
        encoding: "utf8",
      }),
    );
    assert.equal(result.facts.pnpm, "9.12.0");
    assert.equal(result.facts.turbo, "2.10.9");
    assert.equal(result.facts.node.node, process.versions.node);
    assert.equal(
      readFileSync(output, "utf8"),
      `ready=true\ncompatibility=${result.compatibility}\n`,
    );
    writeFileSync(output, "");
    writeFileSync(
      pnpm,
      '#!/bin/sh\necho "private token failure" >&2\nexit 7\n',
      { mode: 0o700 },
    );
    const failed = spawnSync(process.execPath, [script, "example-ci-v2"], {
      env,
      encoding: "utf8",
    });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, "");
    assert.equal(
      failed.stderr,
      "LayerCache runtime identity unavailable. Run the normal tasks without shared task caches.\n",
    );
    assert.equal(readFileSync(output, "utf8"), "ready=false\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
