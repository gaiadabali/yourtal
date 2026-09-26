// pm2 processes for YourTal on Helios, run as the site user `uyourtal`.
//
// Every path goes through /home/uyourtal/current, the symlink gaiada-deploy
// swaps per release, so `pm2 reload` picks up the new code. Node is YourTal's
// own pinned copy (/opt/yourtal/node): the system Node is shared with the
// other sites on this box and stays at their version.
//
// Secrets come from /opt/yourtal/secrets/app.env via --env-file; nothing
// secret is in this file or the artifact. Ports: infra/PORTS.md.
const NODE = "/opt/yourtal/node/bin/node";
const ENV_FILE = "/opt/yourtal/secrets/app.env";
const CURRENT = "/home/uyourtal/current";

const node = (name, script, env) => ({
  name,
  script,
  cwd: CURRENT,
  interpreter: NODE,
  node_args: [`--env-file=${ENV_FILE}`, "--enable-source-maps"],
  env: { NODE_ENV: "production", ...env },
  max_memory_restart: "700M",
});

// The Go services read their own variables from app.env through a tiny
// wrapper, because pm2 cannot load an env file for a non-Node binary.
const go = (name, binary) => ({
  name,
  script: `${CURRENT}/deploy/run-with-env.sh`,
  args: [ENV_FILE, `${CURRENT}/bin/${binary}`],
  cwd: CURRENT,
  interpreter: "/bin/bash",
  max_memory_restart: "300M",
});

module.exports = {
  apps: [
    node("yourtal-web", `${CURRENT}/apps/web/server.js`, { PORT: "26300", HOSTNAME: "127.0.0.1" }),
    node("yourtal-api", `${CURRENT}/api/dist/main.js`, { PORT: "26301", HOST: "127.0.0.1" }),
    node("yourtal-worker", `${CURRENT}/worker/dist/main.js`, {}),
    go("yourtal-ledger", "ledger"),
    go("yourtal-voucher", "voucher"),
  ],
};
