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
  browserRef = browser;
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

// ---------------------------------------------------------------------------
// "page-reader" MCP server (POST /mcp). Small local models can't fit a whole
// page snapshot in context, so this returns only the text that matters.
// ---------------------------------------------------------------------------
let browserRef = null;

const READ_TOOL = {
  name: 'read_page',
  description:
    'Read the text of the page currently open in the browser. Pass `query` (keywords such as "population") to get only the passages that mention them, with surrounding lines; omit it to get the start of the main content. Use this to read information after browser_navigate or a click.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to look for, e.g. "population 2021". Matching is case-insensitive.' },
      max_chars: { type: 'number', description: 'Maximum characters to return (default 6000).' },
    },
  },
};

async function readPage({ query, max_chars }) {
  const page = browserRef ? activePage(browserRef) : null;
  if (!page) return 'No page is open. Call browser_navigate first.';
  const limit = Math.min(Math.max(Number(max_chars) || 6000, 500), 20000);
  const text = await page.evaluate(() => {
    const root =
      document.querySelector('main, article, [role="main"], #content, #main') || document.body;
    return root ? root.innerText : '';
  });
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const header = `URL: ${page.url()}\nTitle: ${await page.title().catch(() => '')}\n`;
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) {
    return `${header}\n${lines.join('\n').slice(0, limit)}`;
  }
  // Score lines by how many query words they contain; keep the best with 3 lines of context after.
  const scored = lines
    .map((line, i) => ({ i, score: words.filter((w) => line.toLowerCase().includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  if (scored.length === 0) return `${header}\nNo lines mention: ${words.join(', ')}.`;
  const taken = new Set();
  const chunks = [];
  let size = 0;
  for (const { i } of scored) {
    if (taken.has(i)) continue;
    const from = Math.max(0, i - 1);
    const to = Math.min(lines.length, i + 4);
    const chunk = lines.slice(from, to).filter((_, k) => !taken.has(from + k));
    for (let k = from; k < to; k++) taken.add(k);
    const block = chunk.join('\n');
    if (size + block.length > limit) break;
    chunks.push(block);
    size += block.length;
    if (chunks.length >= 12) break;
  }
  return `${header}\n${chunks.join('\n---\n')}`;
}

// One MCP server for LibreChat: Playwright MCP's browser_* tools (proxied from :8931)
// plus read_page, so users only switch on a single "Browser" tool.
const UPSTREAM = process.env.PLAYWRIGHT_MCP_URL || 'http://127.0.0.1:8931/mcp';
let upstreamSession = null;
let upstreamId = 0;

async function upstreamPost(body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (upstreamSession) headers['mcp-session-id'] = upstreamSession;
  const res = await fetch(UPSTREAM, { method: 'POST', headers, body: JSON.stringify(body) });
  upstreamSession = res.headers.get('mcp-session-id') || upstreamSession;
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: res.status });
  if (!text) return null;
  const data = text.split('\n').filter((l) => l.startsWith('data:')).pop();
  return JSON.parse(data ? data.slice(5) : text);
}

async function upstreamInit() {
  upstreamSession = null;
  await upstreamPost({
    jsonrpc: '2.0',
    id: ++upstreamId,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'browser-live', version: '1.0.0' } },
  });
  await upstreamPost({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function upstream(method, params) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!upstreamSession) await upstreamInit();
      const reply = await upstreamPost({ jsonrpc: '2.0', id: ++upstreamId, method, params });
      if (reply?.error) throw new Error(reply.error.message);
      return reply?.result;
    } catch (e) {
      upstreamSession = null; // session expired or server restarted: re-initialize once
      if (attempt === 1) throw e;
    }
  }
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (e) => ({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: params?.protocolVersion ?? '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'browser', version: '1.0.0' },
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      try {
        const { tools = [] } = (await upstream('tools/list', {})) ?? {};
        return ok({ tools: [...tools, READ_TOOL] });
      } catch (e) {
        return fail(e);
      }
    case 'tools/call': {
      if (params?.name !== 'read_page') {
        try {
          return ok(await upstream('tools/call', params));
        } catch (e) {
          return fail(e);
        }
      }
      try {
        const text = await readPage(params.arguments ?? {});
        return ok({ content: [{ type: 'text', text }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: `Could not read the page: ${e.message}` }] });
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}

function serveMcp(req, res) {
  if (req.method === 'DELETE') return res.writeHead(200).end();
  if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return res.writeHead(400).end();
    }
    const batch = Array.isArray(msg);
    const replies = (await Promise.all((batch ? msg : [msg]).map(handleRpc))).filter(Boolean);
    if (replies.length === 0) return res.writeHead(202).end();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(batch ? replies : replies[0]));
  });
}

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const path = (req.url || '/').split('?')[0];
    if (path === '/mcp') return serveMcp(req, res);
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
