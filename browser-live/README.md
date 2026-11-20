# Browser live view

Lets you watch, in the chat's **Session** panel, the browser that the "+ Browser" model presets control.

- `start.sh` runs inside the `mcr.microsoft.com/playwright/mcp` image. It starts a headless Chromium
  (via `viewer.mjs`) and attaches Playwright MCP to it over CDP, so the model's `browser_*` tools and
  the live view share one browser.
- `viewer.mjs` streams the active tab as MJPEG on port 9333 (`/stream`, `/frame.jpg`, `/status`).
- `client/src/components/Chat/Session/BrowserLive.tsx` shows that stream as a "Browser" section in the
  Session panel. It only appears while the viewer answers. Override the address at build time with
  `VITE_BROWSER_LIVE_URL` (default `http://localhost:9333`).

## docker-compose.override.yml

```yaml
services:
  api:
    image: librechat-local:browser-live   # built from this fork: docker build -t librechat-local:browser-live .
    depends_on:
      - playwright-mcp
  playwright-mcp:
    container_name: playwright-mcp
    image: mcr.microsoft.com/playwright/mcp:latest
    restart: always
    entrypoint: ["/bin/sh", "/browser-live/start.sh"]
    volumes:
      - ./browser-live:/browser-live:ro
    ports:
      - "127.0.0.1:9333:9333"
```

And in `librechat.yaml`:

```yaml
mcpSettings:
  allowedAddresses:
    - 'playwright-mcp:8931'
mcpServers:
  playwright:
    type: streamable-http
    url: http://playwright-mcp:8931/mcp
```
