#!/bin/bash
# 3.9.h: apply the IPv6 /64 key and the /oidc/ site-wide ceiling to the LIVE
# vhost without replacing it (the live file carries Certbot's TLS blocks and an
# /api/dev/ block that the repo copy does not). Idempotent, backs up first,
# runs `nginx -t`, restores the backup if the test fails, reloads only on pass.
#   sudo patch-3.9h.sh [vhost-file]   (default /etc/nginx/sites-enabled/yourtal.gaiada.com.conf)
# With a file argument it only edits that file (no backup/test/reload): for rehearsal.
set -Eeuo pipefail
F=${1:-/etc/nginx/sites-enabled/yourtal.gaiada.com.conf}
live=$([ $# -eq 0 ] && echo 1 || true)

grep -q 'yt_oidc_site' "$F" && { echo "already patched"; exit 0; }
if [ -n "$live" ]; then
  # Never next to $F: nginx includes sites-enabled/*, so a backup there loads twice.
  install -d -m 700 /root/nginx-backups
  B="/root/nginx-backups/$(basename "$F").bak-3.9h-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$F" "$B"
  echo "backup: $B"
fi

python3 - "$F" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, "anchor not found exactly once: " + a
    s = s.replace(a, b)
rep("limit_req_zone $binary_remote_addr zone=yt_oidc_auth:10m rate=30r/m;\nlimit_req_zone $binary_remote_addr zone=yt_oidc_token:10m rate=10r/s;\n",
"""# New zone names (…64): nginx refuses a reload that changes an existing zone's key.
# 3.9.h: an IPv6 client owns a whole /64, so a per-address key is free to
# rotate. Keep the first 8 of the 16 bytes; IPv4 (4 bytes) falls to default.
map $binary_remote_addr $yt_ip_key {
  "~(?s)^(?<yt_v6_net>.{8}).{8}$" $yt_v6_net;
  default $binary_remote_addr;
}
limit_req_zone $yt_ip_key zone=yt_oidc_auth64:10m rate=30r/m;
limit_req_zone $yt_ip_key zone=yt_oidc_token64:10m rate=10r/s;
# Site-wide ceiling over all of /oidc/ (one shared key).
limit_req_zone $server_name zone=yt_oidc_site:1m rate=50r/s;
""")
rep("    client_max_body_size 64k;\n    proxy_read_timeout 30;\n\n    # Each sign-in",
"    client_max_body_size 64k;\n    proxy_read_timeout 30;\n    limit_req zone=yt_oidc_site burst=100 nodelay;\n    limit_req_status 429;\n\n    # A nested limit_req replaces the parent's, so the two below repeat the\n    # site ceiling.\n    # Each sign-in")
rep("      limit_req zone=yt_oidc_auth burst=20 nodelay;\n", "      limit_req zone=yt_oidc_auth64 burst=20 nodelay;\n      limit_req zone=yt_oidc_site burst=100 nodelay;\n")
rep("      limit_req zone=yt_oidc_token burst=50 nodelay;\n", "      limit_req zone=yt_oidc_token64 burst=50 nodelay;\n      limit_req zone=yt_oidc_site burst=100 nodelay;\n")
open(p, "w").write(s)
PY

if [ -n "$live" ]; then
  if nginx -t; then
    systemctl reload nginx && echo "reloaded"
  else
    cp -p "$B" "$F"; echo "nginx -t FAILED: restored $B, nothing reloaded"; exit 1
  fi
fi
