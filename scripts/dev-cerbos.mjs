#!/usr/bin/env node
// This worktree's own Cerbos PDP, on the port in its PDP_BASE_URL, serving its own ./policies.
// Uses `docker run`, not compose: a compose command in a worktree acts on the shared stack.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const port = new URL(process.env.PDP_BASE_URL ?? "http://127.0.0.1:26592").port;
const slot = port.match(/^263([1-9])5$/)?.[1];
if (!slot) {
  console.error(
    `PDP_BASE_URL port ${port} is not a slot port (26315, 26325, 26335). The main checkout uses compose's cerbos.`,
  );
  process.exit(1);
}

const name = `yourtal-cerbos-${slot}`;
const docker = (...args) => spawnSync("docker", args, { stdio: "inherit" }).status ?? 1;
spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
process.exit(
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "-p",
    `127.0.0.1:${port}:3592`,
    "-v",
    `${path.join(repoRoot, "policies")}:/policies:ro`,
    "-v",
    `${path.join(repoRoot, "infra", "cerbos", "config.yaml")}:/config/config.yaml:ro`,
    "ghcr.io/cerbos/cerbos:0.55.0",
    "server",
    "--config=/config/config.yaml",
  ),
);
