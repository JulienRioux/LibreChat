#!/usr/bin/env node
// Runs browsing tasks against a browser MCP endpoint with a local model, the way the chat
// host would: the model gets the endpoint's tool list, calls tools, and answers. Each answer
// is checked against a known value. No dependencies; needs Node 20+.
//
//   node eval/run.mjs --mcp http://127.0.0.1:9333/mcp --model qwen3-32k-fast:14b \
//     --prompt eval/prompts/compact.txt --out /tmp/run.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function options(argv) {
  const opts = {
    mcp: 'http://127.0.0.1:9333/mcp',
    llm: 'http://127.0.0.1:11434/v1',
    model: 'qwen3-32k-fast:14b',
    prompt: path.join(here, 'prompts', 'compact.txt'),
    tasks: path.join(here, 'tasks.json'),
    base: 'http://localhost:8080',
    steps: 15,
    wait: 600,
    limit: 900,
    trace: false,
    runs: 1,
    window: 32768,
    assumed: 38912,
    only: '',
    out: '',
    effort: '',
    tokens: 0,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in opts)) throw new Error(`unknown option ${argv[i]}`);
    if (typeof opts[key] === 'boolean') opts[key] = true;
    else opts[key] = typeof opts[key] === 'number' ? Number(argv[++i]) : argv[++i];
  }
  return opts;
}

let rpcId = 0;
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  const line = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .pop();
  const reply = JSON.parse(line ? line.slice(5) : text);
  if (reply.error) throw new Error(reply.error.message);
  return reply.result;
}

async function call(url, name, args) {
  try {
    const result = await rpc(url, 'tools/call', { name, arguments: args });
    // The screenshot in a result is for the chat; a model is only ever given the text.
    const text = (result?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return { text, failed: result?.isError === true };
  } catch (e) {
    return { text: `Error: ${e.message}`, failed: true };
  }
}

/** The host validates arguments against the tool schema before the server sees them. */
function invalid(tool, args) {
  const schema = tool.inputSchema ?? {};
  const props = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (args[key] === undefined)
      return `Received tool input did not match expected schema: "${key}" is required`;
  }
  for (const [key, value] of Object.entries(args)) {
    const want = props[key]?.type;
    if (!want || value == null) continue;
    const got = Array.isArray(value) ? 'array' : typeof value;
    const ok = want === got || (want === 'integer' && got === 'number');
    if (!ok)
      return `Received tool input did not match expected schema: "${key}" must be ${want}, got ${got}`;
  }
  return null;
}

/** Mirrors the host's cap on one tool result: 30% of the window it assumes, head and tail kept. */
function cap(text, assumed) {
  const max = Math.floor(assumed * 0.3) * 4;
  if (text.length <= max) return text;
  const note = `\n\n… [truncated: ${text.length} chars exceeded ${max} limit] …\n\n`;
  const head = Math.ceil((max - note.length) * 0.7);
  return text.slice(0, head) + note + text.slice(text.length - (max - note.length - head));
}

const normal = (s) =>
  String(s)
    .toLowerCase()
    .replace(/(\d)[,\u00a0\u202f ](?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ');

function passed(task, answer) {
  const text = normal(answer);
  const hit = (pattern) => new RegExp(pattern, 'i').test(text);
  return task.expect.every(hit) && !(task.reject ?? []).some(hit);
}

async function chat(opts, messages, tools) {
  const body = { model: opts.model, messages, tools, stream: false };
  if (opts.effort) body.reasoning_effort = opts.effort;
  if (opts.tokens) body.max_tokens = opts.tokens;
  // Streamed, as the chat host does it: a long generation would otherwise hit the HTTP
  // client's limit on waiting for response headers.
  body.stream = true;
  body.stream_options = { include_usage: true };
  const started = Date.now();
  const res = await fetch(`${opts.llm}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.wait * 1000),
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const message = { content: '', reasoning: '', tool_calls: [] };
  let usage = {};
  let finish = '';
  let rest = '';
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    rest += chunk;
    const rows = rest.split('\n');
    rest = rows.pop();
    for (const row of rows) {
      if (!row.startsWith('data:') || row.includes('[DONE]')) continue;
      const data = JSON.parse(row.slice(5));
      if (data.usage) usage = data.usage;
      finish = data.choices?.[0]?.finish_reason ?? finish;
      const delta = data.choices?.[0]?.delta ?? {};
      message.content += delta.content ?? '';
      message.reasoning += delta.reasoning ?? delta.reasoning_content ?? '';
      for (const part of delta.tool_calls ?? []) {
        const at = part.index ?? message.tool_calls.length;
        const slot = (message.tool_calls[at] ??= {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        });
        slot.id ||= part.id ?? '';
        slot.function.name ||= part.function?.name ?? '';
        slot.function.arguments += part.function?.arguments ?? '';
      }
    }
  }
  message.tool_calls = message.tool_calls.filter(Boolean);
  return { message, usage, finish, ms: Date.now() - started };
}

async function attempt(opts, task, defs, system) {
  const tools = defs.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const byName = new Map(defs.map((t) => [t.name, t]));
  const opener = byName.has('open_url') ? 'open_url' : 'browser_navigate';
  await call(opts.mcp, opener, { url: 'about:blank' });

  const question = task.question.replaceAll('{base}', opts.base);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: question },
  ];
  const log = {
    id: task.id,
    question,
    steps: 0,
    calls: [],
    peak: 0,
    think: 0,
    ms: 0,
    errors: 0,
    rejected: 0,
  };

  for (let step = 1; step <= opts.steps; step++) {
    if (log.ms > opts.limit * 1000) {
      log.outcome = 'time';
      return log;
    }
    const { message, usage, finish, ms } = await chat(opts, messages, tools);
    log.steps = step;
    log.ms += ms;
    log.peak = Math.max(log.peak, usage.prompt_tokens ?? 0);
    log.think += (message.reasoning ?? message.reasoning_content ?? '').length;
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const answer = (message.content ?? '').trim();
      log.answer = answer;
      log.outcome = 'empty';
      if (answer) log.outcome = passed(task, answer) ? 'pass' : 'wrong';
      // An empty turn usually hides a tool call the server could not parse; keep what was thought.
      if (!answer)
        log.note = {
          finish,
          tokens: usage.completion_tokens,
          thought: message.reasoning.slice(-600),
        };
      return log;
    }
    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls });
    // The host sends the calls of one turn at the same time, so do the same.
    const jobs = calls.map((c) => {
      const name = c.function?.name ?? '';
      let args = {};
      try {
        args =
          typeof c.function?.arguments === 'string'
            ? JSON.parse(c.function.arguments || '{}')
            : (c.function?.arguments ?? {});
      } catch {
        return { name, args, text: 'Error: tool arguments were not valid JSON.', failed: true };
      }
      const tool = byName.get(name);
      if (!tool) return { name, args, text: `Error: no tool named "${name}".`, failed: true };
      const reject = invalid(tool, args);
      if (reject) {
        log.rejected++;
        return { name, args, text: reject, failed: true };
      }
      return call(opts.mcp, name, args).then((out) => ({ name, args, ...out }));
    });
    const outs = await Promise.all(jobs);
    for (const [i, c] of calls.entries()) {
      const { name, args, text, failed } = outs[i];
      if (failed) log.errors++;
      const shown = cap(text, opts.assumed);
      log.calls.push({ step, name, args, chars: text.length, failed, head: shown.slice(0, 160) });
      if (opts.trace) {
        console.log(
          `  ${task.id} step ${step}: ${name}(${JSON.stringify(args)}) -> ${failed ? 'ERROR ' : ''}${text.length} chars`,
        );
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: shown });
    }
  }
  log.outcome = 'steps';
  return log;
}

async function main() {
  const opts = options(process.argv.slice(2));
  const system = fs.readFileSync(opts.prompt, 'utf8').trim();
  let tasks = JSON.parse(fs.readFileSync(opts.tasks, 'utf8'));
  if (opts.only) {
    const wanted = new Set(opts.only.split(','));
    tasks = tasks.filter((t) => wanted.has(t.id));
  }
  // A service that was just started accepts connections a moment before it answers.
  let listed;
  for (let i = 0; i < 40 && !listed; i++) {
    listed = await rpc(opts.mcp, 'tools/list', {}).catch(() => null);
    if (!listed) await new Promise((r) => setTimeout(r, 500));
  }
  if (!listed) throw new Error(`no answer from ${opts.mcp}`);
  const { tools: defs } = listed;
  const schema = defs.reduce(
    (n, t) => n + JSON.stringify([t.name, t.description, t.inputSchema]).length,
    0,
  );
  console.log(
    `model ${opts.model} | ${defs.length} tools (${schema} chars) | ${tasks.length} tasks x ${opts.runs}`,
  );

  const results = [];
  for (let run = 1; run <= opts.runs; run++) {
    for (const task of tasks) {
      let log;
      try {
        log = await attempt(opts, task, defs, system);
      } catch (e) {
        log = {
          id: task.id,
          outcome: 'crash',
          answer: e.message,
          steps: 0,
          calls: [],
          peak: 0,
          ms: 0,
          errors: 0,
          rejected: 0,
        };
      }
      log.run = run;
      log.overflow = log.peak >= opts.window - 64;
      results.push(log);
      if (!opts.quiet) {
        const trail = log.calls.map((c) => c.name + (c.failed ? '!' : '')).join(' > ');
        console.log(
          `${log.outcome.toUpperCase().padEnd(6)} ${task.id.padEnd(16)} steps ${String(log.steps).padStart(2)} | peak ${String(log.peak).padStart(5)} tok | ${Math.round(log.ms / 1000)}s | ${trail}`,
        );
        if (log.outcome !== 'pass')
          console.log(`       answer: ${(log.answer ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
      }
      if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ opts, results }, null, 1));
    }
  }
  const pass = results.filter((r) => r.outcome === 'pass').length;
  const sum = (key) => results.reduce((n, r) => n + (r[key] ?? 0), 0);
  const count = (o) => results.filter((r) => r.outcome === o).length;
  console.log(
    `\n${pass}/${results.length} passed | wrong ${count('wrong')} | out of steps ${count('steps')} | empty ${count('empty')} | crash ${count('crash')}` +
      ` | avg steps ${(sum('steps') / results.length).toFixed(1)} | tool errors ${sum('errors')} (schema ${sum('rejected')})` +
      ` | avg peak ${Math.round(sum('peak') / results.length)} tok | overflowed ${results.filter((r) => r.overflow).length} | ${Math.round(sum('ms') / 60000)} min`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
