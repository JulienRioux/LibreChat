#!/usr/bin/env node
// Puts result files written by run.mjs side by side: passes per task, then totals.
//
//   node eval/compare.mjs before.json after.json
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node eval/compare.mjs <results.json> [<results.json> ...]');
  process.exit(1);
}

const runs = files.map((file) => {
  const { opts, results } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { name: path.basename(file, '.json'), model: opts.model, results };
});

const tasks = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
const width = Math.max(...tasks.map((t) => t.length), 5);
const cell = (text) => String(text).padStart(Math.max(...runs.map((r) => r.name.length), 7) + 2);

console.log(`${'task'.padEnd(width)}${runs.map((r) => cell(r.name)).join('')}`);
for (const task of tasks) {
  const row = runs.map((r) => {
    const mine = r.results.filter((x) => x.id === task);
    return cell(
      mine.length === 0 ? '-' : `${mine.filter((x) => x.outcome === 'pass').length}/${mine.length}`,
    );
  });
  console.log(`${task.padEnd(width)}${row.join('')}`);
}

const total = (r, pick) => r.results.reduce((n, x) => n + (pick(x) ?? 0), 0);
const mean = (r, pick) => (r.results.length === 0 ? 0 : total(r, pick) / r.results.length);
const line = (label, value) =>
  console.log(`${label.padEnd(width)}${runs.map((r) => cell(value(r))).join('')}`);

console.log('-'.repeat(width + runs.length * cell('').length));
line(
  'passed',
  (r) => `${r.results.filter((x) => x.outcome === 'pass').length}/${r.results.length}`,
);
line('steps', (r) => mean(r, (x) => x.steps).toFixed(1));
line('peak tok', (r) => Math.round(mean(r, (x) => x.peak)));
line('tool err', (r) => total(r, (x) => x.errors));
line('seconds', (r) => Math.round(mean(r, (x) => x.ms) / 1000));
line('empty', (r) => r.results.filter((x) => x.outcome === 'empty').length);
console.log(`\n${runs.map((r) => `${r.name}: ${r.model}`).join('\n')}`);
