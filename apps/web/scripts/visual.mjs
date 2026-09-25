#!/usr/bin/env node
// TASKS.md 3.6.b — `pnpm test:visual`. Runs playwright.visual.config.ts's
// suite against a Linux Chromium so a baseline made on this Windows machine
// matches CI on ubuntu-latest.
//
// The browser runs inside `mcr.microsoft.com/playwright:v1.63.0-noble`
// (pinned to the exact @playwright/test version in package.json — a
// mismatched client/server protocol version refuses to connect). The app
// itself is built and started on the HOST by playwright.visual.config.ts's
// own `webServer` (this script never touches that): this workspace's
// node_modules hold native binaries built for this machine, which a Linux
// container can't run, so only the browser moves — see that config file's
// header comment for the full reasoning.
//
// This script's only job is the container: start it if it is not already
// running, wait for its `run-server` to accept connections, run
// `playwright test`, then stop the container. Any arguments this script is
// called with (e.g. `--update-snapshots`) pass straight through to
// `playwright test`.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Same PLAYWRIGHT_PORT the rest of this app's Playwright configs read (see
// ../playwright-port.ts) — duplicated rather than imported because this is a
// plain script Node runs directly with no TypeScript loader, exactly like
// packages/db/scripts/atlas.mjs duplicates its own .env read for the same
// reason. Keep the offsets here in sync with playwright.visual.config.ts's
// own comment if either changes.
function playwrightPort(offset) {
  let fromFile;
  try {
    fromFile = parseEnv(readFileSync(path.join(webRoot, "../../.env"), "utf8"))["PLAYWRIGHT_PORT"];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return Number(process.env.PLAYWRIGHT_PORT ?? fromFile ?? 3100) + offset;
}

const basePort = playwrightPort(0);
const controlPort = playwrightPort(3); // must match playwright.visual.config.ts
const containerName = `yourtal-pw-visual-${basePort}`; // unique per slot, never collides across worktrees
const image = "mcr.microsoft.com/playwright:v1.63.0-noble"; // matches @playwright/test in package.json

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Os}}"], {
    stdio: "pipe",
  });
  return result.status === 0;
}

function isContainerRunning() {
  const result = spawnSync(
    "docker",
    ["ps", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  );
  return result.stdout.trim() === containerName;
}

function startContainer() {
  console.log(`[visual] starting ${containerName} (${image}) on 127.0.0.1:${controlPort}...`);
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-p",
      `127.0.0.1:${controlPort}:3000`,
      "--add-host=host.docker.internal:host-gateway",
      image,
      "npx",
      "-y",
      `playwright@1.63.0`,
      "run-server",
      "--port",
      "3000",
      "--host",
      "0.0.0.0",
    ],
    { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  if (result.status !== 0) {
    console.error("[visual] could not start the Playwright run-server container.");
    process.exit(result.status ?? 1);
  }
}

function stopContainer() {
  console.log(`[visual] stopping ${containerName}...`);
  // --rm already makes the container remove itself on stop; ignore failures
  // here (e.g. it was never started, or was stopped already) so cleanup
  // never masks the real test result.
  spawnSync("docker", ["stop", containerName], { stdio: "inherit" });
}

/** Poll a TCP connect until the run-server inside the container accepts one. */
function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    attempt();
    function attempt() {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for 127.0.0.1:${port} to accept connections`));
          return;
        }
        setTimeout(attempt, 300);
      });
    }
  });
}

async function main() {
  if (!dockerAvailable()) {
    console.error("[visual] Docker is not available. Start Docker Desktop and try again.");
    process.exit(1);
  }

  const startedHere = !isContainerRunning();
  if (startedHere) {
    startContainer();
  } else {
    console.log(`[visual] reusing already-running ${containerName}.`);
  }

  try {
    await waitForPort(controlPort, 30_000);
  } catch (error) {
    console.error(`[visual] ${error.message}`);
    if (startedHere) stopContainer();
    process.exit(1);
  }

  // A single command string with `shell: true`, not an args array — Node
  // warns (DEP0190) about passing args to a shell-spawned child process,
  // since Windows' cmd.exe and POSIX sh quote arguments differently and an
  // args array is silently reinterpreted. Every arg here is a fixed literal
  // or one of this script's own trusted argv, never external input.
  const extraArgs = process.argv.slice(2);
  const command = [
    "pnpm",
    "exec",
    "playwright",
    "test",
    "--config=playwright.visual.config.ts",
    ...extraArgs,
  ]
    .map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
  const test = spawn(command, { cwd: webRoot, stdio: "inherit", shell: true });

  const exitCode = await new Promise((resolve) => {
    test.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });

  if (startedHere) stopContainer();
  process.exit(exitCode);
}

main();
