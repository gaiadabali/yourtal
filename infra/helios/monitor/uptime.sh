#!/usr/bin/env bash
# YourTal sign-in uptime check (3.9.h). Every app's sign-in needs OIDC discovery,
# so this proves it answers, names the right issuer, and the key set it points
# at loads. Same contract as snap-apps' deploy/monitor/uptime.sh: prints FAILED
# lines and exits non-zero. Run by a copy of that repo's alert.sh (see
# infra/HELIOS.md "Monitoring"), which mails once on failure and once on recovery.
#
#   YT_HOST            default yourtal.gaiada.com
#   YT_CHECK_BACKUP=1  also fail if the newest nightly backup is over 26 h old
#                      (only where the backups live, i.e. on Helios)
set -u
host=${YT_HOST:-yourtal.gaiada.com}
base=https://$host/oidc
fail=0

disc=$(curl -fsS --max-time 15 "$base/.well-known/openid-configuration" 2>&1) ||
  { echo "FAILED discovery unreachable: $base/.well-known/openid-configuration"; exit 1; }
printf '%s' "$disc" | grep -q "\"issuer\": *\"$base\"" ||
  { echo "FAILED discovery issuer is not $base"; fail=1; }
jwks=$(printf '%s' "$disc" | sed -n 's/.*"jwks_uri": *"\([^"]*\)".*/\1/p')
if [ -z "$jwks" ] || ! curl -fsS --max-time 15 "$jwks" | grep -q '"keys"'; then
  echo "FAILED jwks_uri missing or serves no keys: ${jwks:-none}"; fail=1
fi

# TLS expiry: refuse a certificate inside two weeks of dying (1209600 s).
if ! openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null |
  openssl x509 -checkend 1209600 >/dev/null 2>&1; then
  echo "FAILED TLS certificate for $host expires within 14 days"; fail=1
fi

if [ "${YT_CHECK_BACKUP:-}" = 1 ]; then
  newest=$(find "${YT_BACKUP_ROOT:-/opt/yourtal/backups}" -mindepth 2 -maxdepth 2 -name yourtal.dump -mmin -1560 2>/dev/null | head -n 1)
  [ -n "$newest" ] || { echo "FAILED backup: no yourtal.dump under 26h old"; fail=1; }
fi

[ $fail -eq 0 ] && echo "OK discovery, issuer, jwks, TLS${YT_CHECK_BACKUP:+, backup} for $host"
exit $fail
