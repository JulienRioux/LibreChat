import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changes, outline, overview, slice } from '../view.mjs';

const REGIONS = [
  { kind: 'content', label: '' },
  { kind: 'header', label: '' },
  { kind: 'nav', label: 'Languages' },
  { kind: 'main', label: '' },
  { kind: 'footer', label: '' },
  { kind: 'dialog', label: 'Cookie consent' },
];

/** Builds a snapshot from `[region, kind, text, extra]` rows. */
function page(rows) {
  const lines = rows.map(([r, k, t, extra], i) => ({
    n: i + 1,
    r,
    k,
    t,
    ...(k === 'h' ? { lv: t.match(/^#+/)[0].length } : {}),
    ...extra,
  }));
  return {
    url: 'http://site.test/a',
    title: 'A page',
    doc: 'd1',
    lines,
    targets: [],
    regions: REGIONS,
  };
}

function long() {
  const rows = [
    [1, 'p', 'Site name [1]'],
    [2, 'links', 'Deutsch [2] · Français [3]'],
    [2, 'links', 'Italiano [4] · Español [5]'],
    [3, 'h', '# Aldoria'],
    [3, 'p', 'Lead paragraph.'],
  ];
  for (let s = 1; s <= 12; s++) {
    rows.push([3, 'h', `## Section ${s}`]);
    for (let p = 0; p < 8; p++)
      rows.push([3, 'p', `Paragraph ${p} of section ${s}. ${'word '.repeat(40)}`]);
  }
  rows.push([4, 'p', 'Privacy [6]']);
  return page(rows);
}

test('shows a small page whole, with a marker where the region changes', () => {
  const text = overview(
    page([
      [1, 'p', 'Shop [1]'],
      [0, 'h', '# All books'],
      [0, 'p', 'First book [2] · £5.00'],
      [4, 'p', 'About [3]'],
    ]),
    { budget: 5000 },
  );
  assert.match(text, /^A page\nURL: http:\/\/site\.test\/a\nWhole page, 4 lines:/);
  assert.match(
    text,
    /-- header --\n1\| Shop \[1\]\n-- content --\n2\| # All books\n3\| First book \[2\] · £5\.00\n-- footer --\n4\| About \[3\]\n\(end of page\)$/,
  );
});

test('shows a long page as an outline plus the start of the main content', () => {
  const snap = long();
  const text = overview(snap, { budget: 3000 });
  assert.match(text, /Long page: \d+ lines/);
  assert.match(text, /Outline \(line\| heading\):\n {2}4\| # Aldoria\n {2}6\| ## Section 1\n/);
  assert.match(text, /Other parts \(lines\): 1 header · 2-3 nav "Languages" · \d+ footer/);
  assert.match(text, /Lines 4-\d+ of \d+:\n-- main --\n4\| # Aldoria\n5\| Lead paragraph\./);
  assert.match(
    text,
    /\(more below\. Fastest: find_in_page with words from the question, or read_page at the line of a heading\. To continue from here: read_page with line \d+\.\)$/,
  );
  assert.doesNotMatch(text, /Deutsch/, 'navigation is summarised, not printed, on a long page');
  assert.ok(text.length < 3600, `overview was ${text.length} characters`);
});

test('thins the outline to the top levels when there are too many headings', () => {
  const rows = [[3, 'h', '# Title']];
  for (let i = 0; i < 30; i++) rows.push([3, 'h', `## Part ${i}`], [3, 'h', `### Detail ${i}`]);
  const heads = outline(page(rows), 40);
  assert.equal(heads.length, 31);
  assert.ok(heads.every((h) => h.lv <= 2));
});

test('announces an open dialog before anything else', () => {
  const text = overview(
    page([
      [3, 'p', 'Story text.'],
      [5, 'p', 'We use cookies. · Accept all [4 button]'],
    ]),
    { budget: 5000 },
  );
  assert.match(
    text,
    /Note: a dialog is open \(dialog "Cookie consent", lines 2-2\)\. Links still work/,
  );
});

test('reads from a line and says how to continue', () => {
  const snap = long();
  const text = slice(snap, 6, { budget: 1200 });
  assert.match(text, /Lines 6-\d+ of \d+:\n-- main --\n6\| ## Section 1\n/);
  const next = Number(text.match(/read_page with line (\d+)/)[1]);
  assert.match(slice(snap, next, { budget: 1200 }), new RegExp(`Lines ${next}-`));
});

test('reads the end of the page when asked for a line past it', () => {
  const snap = long();
  const text = slice(snap, 9999, { budget: 1200 });
  assert.match(text, new RegExp(`The page has only ${snap.lines.length} lines`));
  assert.match(text, /\(end of page\)$/);
});

test('ends a paged list by saying where the other pages are, as a fact', () => {
  const next = page([
    [3, 'p', 'Item one'],
    [3, 'p', 'previous [1: /list?page=1] · next [2: /list?page=3]'],
  ]);
  next.targets = [
    { id: 1, kind: 'link', label: 'previous', href: 'http://site.test/list?page=1' },
    { id: 2, kind: 'link', label: 'next', href: 'http://site.test/list?page=3', next: true },
  ];
  assert.match(overview(next, { budget: 5000 }), /\(end of page; next page: "next" \[2\]\)$/);

  const numbered = page([
    [3, 'p', 'Item one'],
    [3, 'p', '1 [9] 2 [10] 3 [11] 4 [12] 5 [13] 6 [14] 24 [32]'],
  ]);
  assert.match(
    overview(numbered, { budget: 5000 }),
    /\(end of page; other pages: 1 \[9\], 2 \[10\], 3 \[11\], 4 \[12\], …, 24 \[32\]\)$/,
  );

  const plain = page([
    [3, 'p', 'Chapter 3 [7] of 12'],
    [3, 'p', 'Text.'],
  ]);
  assert.match(overview(plain, { budget: 5000 }), /\(end of page\)$/);
});

test('reports an empty page plainly', () => {
  assert.match(overview(page([]), { budget: 1000 }), /The page has no readable text\./);
});

test('describes what an action changed on the same page', () => {
  const before = page([
    [3, 'p', 'Basket (0)'],
    [3, 'p', 'Unchanged line'],
  ]);
  const after = page([
    [3, 'p', 'Basket (1)'],
    [3, 'p', 'Unchanged line'],
    [3, 'p', 'Added to your basket.'],
  ]);
  const text = changes(before, after);
  assert.match(text, /New or changed lines:\n1\| Basket \(1\)\n3\| Added to your basket\./);
  assert.match(text, /Lines that went away:\n {2}Basket \(0\)/);
  assert.doesNotMatch(text, /Unchanged line/);
});

test('says so when nothing changed, and gives up listing when too much did', () => {
  const same = page([
    [3, 'p', 'One'],
    [3, 'p', 'Two'],
  ]);
  assert.equal(
    changes(
      same,
      page([
        [3, 'p', 'One'],
        [3, 'p', 'Two'],
      ]),
    ),
    'Nothing on the page changed.',
  );
  const many = page(Array.from({ length: 40 }, (_, i) => [3, 'p', `New ${i}`]));
  assert.equal(changes(same, many), null);
});
