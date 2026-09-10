#!/bin/bash
set -euo pipefail
# Run this explicitly after reviewing docs/DEPLOYMENT.md. Never uses Funnel.
if [[ ! -f .env ]]; then
  echo 'Create .env and set APP_ORIGIN to the exact private HTTPS origin first.' >&2
  exit 1
fi
tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
