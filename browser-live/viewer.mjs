// Live view of the browser that LibreChat's browser presets drive.
// Starts a headless Chromium with a CDP port (Playwright MCP attaches to it),
// then streams the active tab as MJPEG on :9333 for the Session panel.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire('/app/');
const { chromium } = require('playwright-core');

const CDP_PORT = 9222;
const VIEW_PORT = Number(process.env.VIEW_PORT || 9333);
const FPS = Number(process.env.VIEW_FPS || 3);

const chrome = spawn(
  chromium.executablePath(),
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,800',
    '--user-data-dir=/tmp/browser-live-profile',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
chrome.on('exit', (code) => {
  console.error(`[viewer] chromium exited (${code})`);
  process.exit(1);
});

let latest = null; // { jpeg: Buffer, url, title, at }
const clients = new Set();
let lastActive = null;

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('could not connect to chromium');
}

function track(page) {
  const mark = () => (lastActive = page);
  page.on('framenavigated', (f) => f === page.mainFrame() && mark());
  page.on('load', mark);
  page.on('close', () => lastActive === page && (lastActive = null));
  mark();
}

function activePage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (lastActive && pages.includes(lastActive)) return lastActive;
  return pages.filter((p) => p.url() !== 'about:blank').at(-1) ?? pages.at(-1) ?? null;
}

function push(frame) {
  for (const res of clients) {
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.length}\r\n\r\n`);
    res.write(frame.jpeg);
    res.write('\r\n');
  }
}

async function main() {
  const browser = await connect();
  const watch = (ctx) => {
    ctx.pages().forEach(track);
    ctx.on('page', track);
  };
  browser.contexts().forEach(watch);
  browser.on?.('context', watch);
  console.error(`[viewer] streaming on :${VIEW_PORT}, CDP on :${CDP_PORT}`);

  setInterval(async () => {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) if (!p.__tracked) { p.__tracked = true; track(p); }
    }
    const page = activePage(browser);
    if (!page) return;
    try {
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 2000, animations: 'allow', caret: 'initial' });
      const frame = { jpeg, url: page.url(), title: await page.title().catch(() => ''), at: Date.now() };
      if (!latest || !latest.jpeg.equals(jpeg)) push(frame);
      latest = frame;
    } catch {
      /* page busy or navigating; try again next tick */
    }
  }, Math.round(1000 / FPS));
}

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const path = (req.url || '/').split('?')[0];
    if (path === '/stream') {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
      clients.add(res);
      if (latest) push(latest);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/frame.jpg' && latest) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(latest.jpeg);
    }
    if (path === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ url: latest?.url ?? null, title: latest?.title ?? null, at: latest?.at ?? null }));
    }
    res.writeHead(404).end();
  })
  .listen(VIEW_PORT, '0.0.0.0');

main().catch((e) => {
  console.error('[viewer]', e);
  process.exit(1);
});
