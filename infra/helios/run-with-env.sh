#!/bin/bash
# Runs a binary with the variables from an env file (pm2 loads env files only
# for Node). Usage: run-with-env.sh <env-file> <binary> [args...]
set -euo pipefail
env_file=$1
shift
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
exec "$@"
