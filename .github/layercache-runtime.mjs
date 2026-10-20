import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const version = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;
const identity = /^[a-zA-Z0-9._+-]+$/;

function value(input, pattern) {
  if (typeof input !== "string" || !pattern.test(input)) {
    throw new Error("Unsupported runtime identity");
  }
  return input;
}

export function runtimeProfile(namespace, input) {
  value(namespace, /^[a-z][a-z0-9-]{0,80}$/);
  if (!["linux", "darwin"].includes(input.platform)) {
    throw new Error("Unsupported runtime platform");
  }
  if (!["x64", "arm64"].includes(input.arch)) {
    throw new Error("Unsupported runtime architecture");
  }
  const node = Object.fromEntries(
    Object.keys(input.node)
      .toSorted()
      .map((key) => [
        value(key, identity),
        value(input.node[key], /^[a-zA-Z0-9._+-]*$/),
      ]),
  );
  value(node.node, version);
  value(node.v8, identity);
  value(node.modules, /^\d+$/);
  const facts = {
    schemaVersion: 1,
    platform: input.platform,
    arch: input.arch,
    system: {
      id: value(input.system.id, identity),
      version: value(input.system.version, identity),
      libc: value(input.system.libc, identity),
    },
    node,
    pnpm: value(input.pnpm, version),
    turbo: value(input.turbo, version),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("hex");
  return {
    schemaVersion: 1,
    ready: true,
    compatibility: `${namespace}-${facts.platform}-${facts.arch}-${digest}`,
    facts,
  };
}

function command(program, args) {
  return execFileSync(program, args, {
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function system() {
  if (process.platform === "darwin") {
    return {
      id: "macos",
      version: command("sw_vers", ["-productVersion"]),
      libc: "system",
    };
  }
  if (process.platform !== "linux")
    throw new Error("Unsupported runtime platform");
  const fields = new Map(
    readFileSync("/etc/os-release", "utf8")
      .split("\n")
      .map((line) => {
        const match = /^(ID|VERSION_ID)=(?:"([^"]+)"|([^"\s]+))$/.exec(line);
        return match ? [match[1], match[2] ?? match[3]] : [];
      })
      .filter((field) => field.length === 2),
  );
  return {
    id: fields.get("ID"),
    version: fields.get("VERSION_ID"),
    libc: process.report.getReport().header.glibcVersionRuntime,
  };
}

function main() {
  const [namespace, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Unexpected runtime arguments");
  const result = runtimeProfile(namespace, {
    platform: process.platform,
    arch: process.arch,
    system: system(),
    node: process.versions,
    pnpm: command("pnpm", ["--version"]),
    turbo: command("pnpm", ["exec", "turbo", "--version"]),
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `ready=true\ncompatibility=${result.compatibility}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch {
    try {
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, "ready=false\n");
    } catch {
      // Missing outputs also decline every shared cache step.
    }
    process.stderr.write(
      "LayerCache runtime identity unavailable. Run the normal tasks without shared task caches.\n",
    );
    process.exitCode = 1;
  }
}
