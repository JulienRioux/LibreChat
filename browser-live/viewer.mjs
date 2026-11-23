// The browser that LibreChat's browser presets drive.
// Starts a headless Chromium and serves the browser tools as an MCP server on :9333/mcp.
// Every tool result carries a screenshot of the page for the chat to show.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { browser as kit, settle } from './tools.mjs';

const require = createRequire('/app/');
const { chromium } = require('playwright-core');

const CDP_PORT = 9222;
const VIEW_PORT = Number(process.env.VIEW_PORT || 9333);
/** `off` leaves the screenshot out of tool results. */
const SHOTS = process.env.BROWSER_SHOTS !== 'off';
/** JPEG quality of a screenshot, 1 to 100. */
const SHOT_QUALITY = Math.min(Math.max(Math.round(Number(process.env.SHOT_QUALITY) || 70), 1), 100);
/** Characters of page text in one tool result; about 3.6 characters make a token. */
const VIEW_CHARS = Number(process.env.VIEW_CHARS || 5000);
/** `compact` offers the six page tools. `full` adds Playwright MCP's own tools, for large models. */
const TOOLSET = process.env.BROWSER_TOOLS === 'full' ? 'full' : 'compact';

const chrome = spawn(
  chromium.executablePath(),
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,800',
    // A page restored from the back/forward cache fires no load events, so Playwright's
    // goBack would wait out its whole timeout. Playwright passes this flag to browsers it launches.
    '--disable-back-forward-cache',
    '--user-data-dir=/tmp/browser-live-profile',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
chrome.on('exit', (code) => {
  console.error(`[viewer] chromium exited (${code})`);
  process.exit(1);
});

let lastActive = null;
const tracked = new WeakSet();

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
  if (tracked.has(page)) return;
  tracked.add(page);
  const mark = () => (lastActive = page);
  page.on('framenavigated', (f) => f === page.mainFrame() && mark());
  page.on('load', mark);
  page.on('close', () => lastActive === page && (lastActive = null));
  mark();
}

function activePage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  // A page whose context announced nothing (Playwright MCP attaching over CDP) is picked up here.
  pages.forEach(track);
  if (lastActive && pages.includes(lastActive)) return lastActive;
  return pages.filter((p) => p.url() !== 'about:blank').at(-1) ?? pages.at(-1) ?? null;
}

/**
 * The page as a person would see it, attached to every tool result for the chat to show. It is
 * addressed to the user alone, so the chat host keeps it out of what the model reads.
 */
async function shot() {
  if (!SHOTS) return null;
  const page = browserRef ? activePage(browserRef) : null;
  if (!page || page.url() === 'about:blank') return null;
  try {
    const jpeg = await page.screenshot({
      type: 'jpeg',
      quality: SHOT_QUALITY,
      timeout: 3000,
      // Left as they are: freezing animations or hiding the caret would change the page.
      animations: 'allow',
      caret: 'initial',
    });
    return {
      type: 'image',
      data: jpeg.toString('base64'),
      mimeType: 'image/jpeg',
      annotations: { audience: ['user'] },
    };
  } catch {
    return null; // the page is busy or gone: the result goes out without a picture
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
  console.error(`[viewer] tools on :${VIEW_PORT}/mcp, CDP on :${CDP_PORT}`);
}

// ---------------------------------------------------------------------------
// MCP server (POST /mcp). The page tools live in tools.mjs; this file serves them.
// ---------------------------------------------------------------------------
let browserRef = null;

const pages = kit({
  current: () => (browserRef ? activePage(browserRef) : null),
  open: async () => {
    if (!browserRef) throw new Error('the browser is still starting; try again in a moment');
    return (browserRef.contexts()[0] ?? (await browserRef.newContext())).newPage();
  },
  budget: VIEW_CHARS,
});

// With BROWSER_TOOLS=full, Playwright MCP's browser_* tools (proxied from :8931) are offered
// next to the page tools, still as one server.
const UPSTREAM = process.env.PLAYWRIGHT_MCP_URL || 'http://127.0.0.1:8931/mcp';
let upstreamSession = null;
let upstreamId = 0;

async function upstreamPost(body) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (upstreamSession) headers['mcp-session-id'] = upstreamSession;
  const res = await fetch(UPSTREAM, { method: 'POST', headers, body: JSON.stringify(body) });
  upstreamSession = res.headers.get('mcp-session-id') || upstreamSession;
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: res.status });
  if (!text) return null;
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .pop();
  return JSON.parse(data ? data.slice(5) : text);
}

async function upstreamInit() {
  upstreamSession = null;
  await upstreamPost({
    jsonrpc: '2.0',
    id: ++upstreamId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'browser-live', version: '1.0.0' },
    },
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

// Models often send several browser actions at once; run them one after another, in order,
// so a read never races the navigation a click started.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// LibreChat sends a batch of tool calls as parallel HTTP requests, which can arrive out of
// order (a click before the navigate meant to precede it). Collect calls that arrive within a
// short window and run them by JSON-RPC id, which follows the order the model emitted them.
let pending = [];
let flushTimer = null;
let turns = 0;
function ordered(id, fn) {
  return new Promise((resolve) => {
    pending.push({ id: typeof id === 'number' ? id : Number(id) || 0, fn, resolve });
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        const batch = pending.sort((a, b) => a.id - b.id);
        pending = [];
        flushTimer = null;
        // Calls that arrived together were issued together: they share a turn number.
        const turn = ++turns;
        for (const item of batch) serial(() => item.fn(turn)).then(item.resolve, item.resolve);
      }, 150);
    }
  });
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
      if (TOOLSET === 'compact') return ok({ tools: pages.tools });
      try {
        const { tools = [] } = (await upstream('tools/list', {})) ?? {};
        // Tools that a visited page registers (WebMCP) are never offered to the model.
        const extra = tools.filter((t) => !t.name.startsWith('webmcp_') && !pages.has(t.name));
        return ok({ tools: [...pages.tools, ...extra] });
      } catch (e) {
        return fail(e);
      }
    case 'tools/call':
      return ordered(id, (turn) => callTool(id, params, turn));
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}

async function callTool(id, params, turn) {
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (e) => ({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  const said = async (text, failed) => {
    const image = await shot();
    return ok({
      content: [{ type: 'text', text }, ...(image ? [image] : [])],
      ...(failed ? { isError: true } : {}),
    });
  };
  const name = params?.name;
  if (pages.has(name)) {
    const { text, failed } = await pages.call(name, params.arguments ?? {}, { turn });
    return said(text, failed);
  }
  if (TOOLSET !== 'full' || String(name).startsWith('webmcp_')) {
    return said(
      `There is no tool named "${name}". The tools are: ${pages.tools.map((t) => t.name).join(', ')}.`,
      true,
    );
  }
  try {
    const result = await upstream('tools/call', params);
    // A click that opens a new page makes Playwright MCP report "Execution context was
    // destroyed" even though the click worked. Report the navigation instead.
    const text = result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
    const page = browserRef ? activePage(browserRef) : null;
    if (result?.isError && /Execution context was destroyed/i.test(text) && page) {
      await settle(page);
      return said(
        `Done; the page navigated.\nNow on: ${page.url()}\nTitle: ${await page.title().catch(() => '')}`,
      );
    }
    const image = await shot();
    return ok(image ? { ...result, content: [...(result?.content ?? []), image] } : result);
  } catch (e) {
    return fail(e);
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
    const path = (req.url || '/').split('?')[0];
    if (path === '/mcp') return serveMcp(req, res);
    res.writeHead(404).end();
  })
  .listen(VIEW_PORT, '0.0.0.0');

main().catch((e) => {
  console.error('[viewer]', e);
  process.exit(1);
});
