#!/bin/bash
# Spambank T5 (spambank/BUILD.md §5.3, §10 S6): add `location ^~ /api/spambank/` to the LIVE
# vhost without replacing it (the live file carries Certbot's TLS blocks). The mail proxy streams
# uploads (25 MB), downloads and EventSource, so this location buffers nothing and lets a read idle
# 120 s (the proxy pings at least every 60 s). No add_header lines: one in a location drops the
# server-level CSP/HSTS headers there. Idempotent, backs up first, runs `nginx -t`, restores the
# backup if the test fails, reloads only on pass.
#   sudo patch-spambank.sh [vhost-file]   (default /etc/nginx/sites-enabled/yourtal.gaiada.com.conf)
# With a file argument it only edits that file (no backup/test/reload): for rehearsal.
set -Eeuo pipefail
F=${1:-/etc/nginx/sites-enabled/yourtal.gaiada.com.conf}
live=$([ $# -eq 0 ] && echo 1 || true)

grep -q 'location ^~ /api/spambank/' "$F" && { echo "already patched"; exit 0; }
if [ -n "$live" ]; then
  # Never next to $F: nginx includes sites-enabled/*, so a backup there loads twice.
  install -d -m 700 /root/nginx-backups
  B="/root/nginx-backups/$(basename "$F").bak-spambank-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$F" "$B"
  echo "backup: $B"
fi

python3 - "$F" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8", newline="").read()
anchor = "  location /api/ {\n"
assert s.count(anchor) == 1, "anchor not found exactly once: " + anchor
block = """  # Spambank's mail API (spambank/BUILD.md section 5.3): the JMAP proxy streams uploads (25 MB),
  # downloads and EventSource, so nothing is buffered and a read may idle 120 s (the
  # proxy pings at least every 60 s). `^~` keeps the regex locations off these paths.
  # No add_header here: one would drop the server-level headers in this location.
  location ^~ /api/spambank/ {
    proxy_pass http://127.0.0.1:26301;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 26m;
    proxy_read_timeout 120;
    proxy_buffering off;
    proxy_request_buffering off;
  }

"""
s = s.replace(anchor, block + anchor)
open(p, "w", encoding="utf-8", newline="").write(s)
PY

if [ -n "$live" ]; then
  if nginx -t; then
    systemctl reload nginx && echo "reloaded"
  else
    cp -p "$B" "$F"; echo "nginx -t FAILED: restored $B, nothing reloaded"; exit 1
  fi
fi
