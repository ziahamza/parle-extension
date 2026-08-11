#!/bin/sh

set -eu

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 ${PARLE_E2E_SCREEN:-1280x900x24}" "$@"
fi

exec "$@"
