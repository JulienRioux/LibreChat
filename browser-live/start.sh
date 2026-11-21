#!/bin/sh
# Headless Chromium, the browser tools and the live MJPEG view (viewer.mjs).
# With BROWSER_TOOLS=full, Playwright MCP is attached to the same browser over CDP and its
# tools are offered too. Tools that a visited page registers (WebMCP) are never collected.
set -e
node /browser-live/viewer.mjs &
VIEWER=$!
if [ "$BROWSER_TOOLS" != "full" ]; then
  wait $VIEWER
  exit 1
fi
for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:9222/json/version').then(()=>process.exit(0),()=>process.exit(1))"; then break; fi
  sleep 0.5
done
node /app/cli.js --cdp-endpoint http://127.0.0.1:9222 --port 8931 --host 0.0.0.0 \
  --allowed-hosts '*' --image-responses omit --no-webmcp --codegen none &
MCP=$!
# Exit (and let Docker restart us) if either process dies.
while kill -0 $VIEWER 2>/dev/null && kill -0 $MCP 2>/dev/null; do sleep 2; done
exit 1
