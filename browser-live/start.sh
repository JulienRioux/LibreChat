#!/bin/sh
# Headless Chromium + live MJPEG view (viewer.mjs), with Playwright MCP attached over CDP.
set -e
node /browser-live/viewer.mjs &
VIEWER=$!
for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:9222/json/version').then(()=>process.exit(0),()=>process.exit(1))"; then break; fi
  sleep 0.5
done
node /app/cli.js --cdp-endpoint http://127.0.0.1:9222 --port 8931 --host 0.0.0.0 \
  --allowed-hosts '*' --image-responses omit &
MCP=$!
# Exit (and let Docker restart us) if either process dies.
while kill -0 $VIEWER 2>/dev/null && kill -0 $MCP 2>/dev/null; do sleep 2; done
exit 1
