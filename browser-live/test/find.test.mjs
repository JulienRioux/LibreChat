import assert from 'node:assert/strict';
import { test } from 'node:test';
import { find, stem, words } from '../find.mjs';

/** Builds a snapshot from `[kind, text, extra]` rows. */
function page(rows, targets = []) {
  const lines = rows.map(([k, t, extra], i) => ({
    n: i + 1,
    k,
    t,
    r: 0,
    ...(k === 'h' ? { lv: t.match(/^#+/)[0].length } : {}),
    ...extra,
  }));
  return {
    url: 'http://site.test/page',
    title: 'Test page',
    doc: 'd',
    lines,
    targets,
    regions: [{ kind: 'content', label: '' }],
  };
}

const opts = { budget: 4000 };

test('stems plurals and verb endings, leaves numbers and short words alone', () => {
  assert.equal(stem('prices'), 'price');
  assert.equal(stem('categories'), 'category');
  assert.equal(stem('boxes'), 'box');
  assert.equal(stem('opening'), 'open');
  assert.equal(stem('glass'), 'glass');
  assert.equal(stem('2024s'), '2024s');
  assert.equal(stem('bus'), 'bus');
});

test('treats a number with thousands separators as one word', () => {
  assert.deepEqual(words('Population: 3,912,480'), ['population', '3912480']);
  assert.deepEqual(words('3912480'), ['3912480']);
  assert.deepEqual(words('What is the price of it?'), ['price']);
});

test('finds a value whose label is a heading on another line', () => {
  const snap = page([
    ['h', '# Mountain bike'],
    ['p', 'A sturdy frame for rough trails.'],
    ['h', '## Price'],
    ['p', '£45.17'],
    ['h', '## Delivery'],
    ['p', 'Ships in three days.'],
  ]);
  const text = find(snap, 'price', opts);
  assert.match(text, /3\| ## Price/);
  assert.match(text, /4\| £45\.17/);
  assert.doesNotMatch(text, /Ships in three days/);
});

test('shows a matching table row under the heading of its section', () => {
  const snap = page([
    ['h', '## Largest cities'],
    ['row', 'Rank: 1 | City: Port Calder | Population: 412,300'],
    ['row', 'Rank: 2 | City: Ilvane | Population: 318,950'],
  ]);
  const text = find(snap, 'Ilvane', opts);
  assert.match(text, /3\| Rank: 2 \| City: Ilvane \| Population: 318,950/);
  assert.match(text, /under "Largest cities" \(line 1\)/);
  assert.doesNotMatch(text, /Port Calder/);
});

test('matches a table row through the caption of its table', () => {
  const snap = page([
    ['cap', 'Table: Configuration options'],
    ['row', 'Option: retry_limit | Default: 5'],
    ['row', 'Option: retry_backoff | Default: 750ms'],
    ['p', 'Unrelated closing line.'],
  ]);
  const text = find(snap, 'retry_backoff configuration', opts);
  assert.match(text, /3\| Option: retry_backoff \| Default: 750ms/);
  assert.doesNotMatch(text, /Unrelated closing line/);
});

test('prefers the line under the heading the query names', () => {
  const snap = page([
    ['h', '## History'],
    ['p', 'Tin was first mined in the hills.'],
    ['h', '## Economy'],
    ['p', 'Tin accounted for 34 percent of exports.'],
  ]);
  const text = find(snap, 'economy tin', opts);
  assert.ok(
    text.indexOf('34 percent') < text.indexOf('first mined') || !text.includes('first mined'),
  );
});

test('matches a word when the page has a longer or shorter form of it', () => {
  const snap = page([
    ['p', 'The population grew quickly.'],
    ['p', 'Unrelated line.'],
  ]);
  assert.match(find(snap, 'populations', opts), /1\| The population grew/);
});

test('finds a link by the path it leads to', () => {
  const snap = page(
    [
      ['p', 'next [7]'],
      ['p', 'Something else'],
    ],
    [{ id: 7, kind: 'link', label: 'next', href: 'http://site.test/catalogue/page-2.html' }],
  );
  assert.match(find(snap, 'page-2', opts), /1\| next \[7\]/);
});

test('never dead-ends: no match returns advice and the page outline', () => {
  const snap = page([
    ['h', '# Aldoria'],
    ['h', '## Government'],
    ['p', 'The assembly has 180 seats.'],
  ]);
  const text = find(snap, 'zebra', opts);
  assert.match(text, /No line on this page matches "zebra"/);
  assert.match(text, /Try other words/);
  assert.match(text, /2\| ## Government/);
});

test('on a long page a miss points back into the page, not away from it', () => {
  const rows = [
    ['h', '## Government'],
    ['p', 'The assembly has 180 seats.'],
  ];
  for (let i = 0; i < 60; i++) rows.push(['p', `Filler line ${i} ${'word '.repeat(20)}`]);
  const targets = [{ id: 2, kind: 'searchbox', label: 'Search the site' }];
  const text = find(page(rows, targets), 'parliament', { budget: 2000 });
  assert.match(
    text,
    /Next: call find_in_page with another word, or read_page at the line of the section/,
  );
  assert.doesNotMatch(text, /the site has a search field/);
  const short = find(page([['p', 'Nothing here.']], targets), 'parliament', { budget: 2000 });
  assert.match(short, /the site has a search field: "Search the site" \[2 searchbox\]/);
});

test('asks for words when the query is empty', () => {
  assert.match(find(page([['p', 'x']]), '  ', opts), /Give one or more words/);
});

test('keeps the result inside the budget', () => {
  const rows = Array.from({ length: 200 }, (_, i) => [
    'p',
    `Tin report number ${i} ${'padding '.repeat(30)}`,
  ]);
  const text = find(page(rows), 'tin report', { budget: 1500 });
  assert.ok(text.length < 2200, `result was ${text.length} characters`);
});
