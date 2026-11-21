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
  return { text: reply.result.content[0].text, failed: reply.result.isError === true };
};

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

    test('serves the live view status', async () => {
      const status = await fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.json());
      assert.ok('url' in status && 'title' in status);
    });
  },
);
