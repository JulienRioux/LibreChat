// Starts the real service (viewer.mjs with its own Chromium) and talks to it over HTTP, the
// way the chat host does. Needs the Playwright MCP image; skipped elsewhere.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { serve } from './site.mjs';

const PORT = 9555;
const endpoint = `http://127.0.0.1:${PORT}/mcp`;
let next = 0;

async function rpc(method, params, id = ++next) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json();
}

const call = async (name, args, id) => {
  const reply = await rpc('tools/call', { name, arguments: args }, id);
  const [said, ...rest] = reply.result.content;
  return { text: said.text, failed: reply.result.isError === true, rest };
};

/** Width and height from a JPEG's frame header. */
function size(jpeg) {
  for (let i = 2; i + 9 < jpeg.length; i += 2 + jpeg.readUInt16BE(i + 2)) {
    const marker = jpeg[i + 1];
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) return { width: jpeg.readUInt16BE(i + 7), height: jpeg.readUInt16BE(i + 5) };
  }
  return null;
}

describe(
  'server',
  { skip: existsSync('/app/cli.js') ? false : 'needs the Playwright MCP image' },
  () => {
    let service;
    let site;
    let base;

    before(async () => {
      site = await serve(0);
      base = `http://127.0.0.1:${site.address().port}`;
      service = spawn('node', [fileURLToPath(new URL('../viewer.mjs', import.meta.url))], {
        env: { ...process.env, VIEW_PORT: String(PORT), BROWSER_TOOLS: 'compact' },
        stdio: 'ignore',
      });
      // The HTTP port opens before the browser is attached, so wait for a tool to work.
      for (let i = 0; i < 80; i++) {
        const ready = await call('open_url', { url: 'about:blank' }).then(
          (r) => !r.failed,
          () => false,
        );
        if (ready) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('the service did not start');
    });

    after(() => {
      service?.kill();
      site?.close();
    });

    test('answers initialize and offers exactly the six page tools, in few characters', async () => {
      const hello = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
      assert.equal(hello.result.serverInfo.name, 'browser');
      const { tools } = (await rpc('tools/list', {})).result;
      assert.deepEqual(
        tools.map((t) => t.name),
        ['open_url', 'click', 'type_text', 'find_in_page', 'read_page', 'go_back'],
      );
      const size = JSON.stringify(tools).length;
      assert.ok(size < 2600, `tool definitions take ${size} characters`);
      for (const tool of tools) {
        for (const prop of Object.values(tool.inputSchema.properties)) {
          assert.ok(
            ['string', 'number', 'boolean'].includes(prop.type),
            'only plain argument types',
          );
        }
      }
    });

    test('runs a tool and returns the page as text', async () => {
      const opened = await call('open_url', { url: `${base}/shop/` });
      assert.equal(opened.failed, false);
      assert.match(opened.text, /Starlight for Beginners \[\d+\] · £37\.80/);
    });

    test('refuses a tool it does not offer, naming the ones it has', async () => {
      const reply = await call('browser_evaluate', { function: '() => 1' });
      assert.equal(reply.failed, true);
      assert.match(
        reply.text,
        /There is no tool named "browser_evaluate"\. The tools are: open_url, click/,
      );
    });

    test('runs calls that arrive together in the order they were issued', async () => {
      // Sent in reverse; the lower id was issued first by the model.
      const later = call('find_in_page', { text: 'harbour bridge' }, 5002);
      const earlier = call('open_url', { url: `${base}/news/` }, 5001);
      const [found, opened] = await Promise.all([later, earlier]);
      assert.match(opened.text, /Front page - The Calder Courier/);
      assert.match(found.text, /Harbour bridge to reopen/);
    });

    test('does not act on an id the model picked before the page changed', async () => {
      const [opened, clicked] = await Promise.all([
        call('open_url', { url: `${base}/shop/` }, 6001),
        call('click', { id: 5 }, 6002),
      ]);
      assert.equal(opened.failed, false);
      assert.equal(clicked.failed, true);
      assert.match(clicked.text, /the page changed earlier in this turn/);
      const alone = await call('click', { id: 5 }, 6003);
      assert.match(alone.text, /^Clicked "Travel" \[5\]\./);
    });

    test('goes back without waiting out a timeout', async () => {
      // The browser is started by hand here, not by Playwright: without the flag that turns
      // the back/forward cache off, this call returns the right page only after 25 seconds.
      await call('open_url', { url: `${base}/shop/` });
      const category = await call('click', { id: 5 });
      assert.match(category.text, /^Clicked "Travel" \[5\]\./);
      const started = Date.now();
      const back = await call('go_back', {});
      const took = Date.now() - started;
      assert.equal(back.failed, false);
      assert.match(back.text, new RegExp(`^URL: ${base}/shop/$`, 'm'));
      assert.ok(took < 5000, `go_back took ${took} ms`);
    });

    test('attaches a screenshot of the page, addressed to the user alone', async () => {
      const opened = await call('open_url', { url: `${base}/shop/` });
      assert.equal(opened.rest.length, 1, 'one picture after the text');
      const [shot] = opened.rest;
      assert.equal(shot.type, 'image');
      assert.equal(shot.mimeType, 'image/jpeg');
      // The chat host keeps an image for the user out of what the model reads.
      assert.deepEqual(shot.annotations, { audience: ['user'] });
      const jpeg = Buffer.from(shot.data, 'base64');
      assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
      // The viewport, not the whole page: the fixture shop is taller than one screen.
      const { width, height } = size(jpeg);
      assert.equal(width, 1280);
      assert.ok(height >= 400 && height <= 800, `viewport height, got ${height}`);
    });

    test('attaches a screenshot to views and to failed actions alike', async () => {
      await call('open_url', { url: `${base}/shop/` });
      const read = await call('read_page', { line: 1 });
      assert.equal(read.failed, false);
      assert.equal(read.rest[0]?.type, 'image');
      const missed = await call('click', { id: 9999 });
      assert.equal(missed.failed, true);
      assert.equal(missed.rest[0]?.type, 'image');
    });

    test('shows the page an action led to, not the one it started on', async () => {
      const listing = await call('open_url', { url: `${base}/shop/` });
      const travel = await call('click', { id: 5 });
      assert.match(travel.text, /^Clicked "Travel" \[5\]\./);
      assert.notEqual(travel.rest[0].data, listing.rest[0].data);
    });

    test('attaches nothing while no page is open', async () => {
      const blank = await call('open_url', { url: 'about:blank' });
      assert.deepEqual(blank.rest, []);
    });
  },
);
