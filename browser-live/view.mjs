// Renders a page snapshot as text for the model: the whole page when it is small, otherwise
// an outline plus the start of the main content, with every other part one call away.

/** @typedef {import('./snapshot.mjs').Snapshot} Snapshot */
/** @typedef {import('./snapshot.mjs').Line} Line */

const CHROME = new Set(['header', 'nav', 'aside', 'footer']);
/** What `changes` returns when an action left the page as it was. */
export const UNCHANGED = 'Nothing on the page changed.';

/** @param {Snapshot} snap */
export function banner(snap) {
  return `${snap.title || '(untitled page)'}\nURL: ${snap.url}`;
}

/**
 * @param {Snapshot} snap
 * @param {number} index
 */
function label(snap, index) {
  const region = snap.regions[index];
  return region.label ? `${region.kind} "${region.label}"` : region.kind;
}

/** @param {Line} line */
const show = (line) => `${line.n}| ${line.t}`;

/**
 * Lines `from..to` (0-based, end exclusive) with a marker wherever the page region changes.
 * @param {Snapshot} snap
 */
function body(snap, from, to) {
  const out = [];
  let region = -1;
  for (let i = from; i < to; i++) {
    const line = snap.lines[i];
    if (line.r !== region) {
      region = line.r;
      out.push(`-- ${label(snap, region)} --`);
    }
    out.push(show(line));
  }
  return out;
}

/**
 * How many lines starting at `from` fit in `budget` characters. Always at least one.
 * @param {Snapshot} snap
 */
function fit(snap, from, budget) {
  let used = 0;
  let i = from;
  for (; i < snap.lines.length; i++) {
    used += snap.lines[i].t.length + 8;
    if (used > budget && i > from) break;
  }
  return i;
}

/**
 * Headings of the page, thinned to the top levels when there are too many to list.
 * @param {Snapshot} snap
 */
export function outline(snap, limit = 40) {
  const heads = snap.lines.filter((l) => l.k === 'h' && !CHROME.has(snap.regions[l.r].kind));
  let depth = 6;
  let list = heads;
  while (list.length > limit && depth > 1) {
    depth--;
    list = heads.filter((h) => (h.lv ?? 1) <= depth);
  }
  return list.slice(0, limit);
}

/**
 * Runs of lines that belong to the page chrome, as `[from, to, regionIndex]`.
 * @param {Snapshot} snap
 */
function chrome(snap) {
  const runs = [];
  for (const line of snap.lines) {
    const kind = snap.regions[line.r].kind;
    if (!CHROME.has(kind) && kind !== 'dialog') continue;
    const last = runs.at(-1);
    if (last && last[2] === line.r && last[1] === line.n - 1) last[1] = line.n;
    else runs.push([line.n, line.n, line.r]);
  }
  return runs;
}

/**
 * Where reading should start: the main landmark, else the first line outside the chrome.
 * @param {Snapshot} snap
 */
function start(snap) {
  const main = snap.lines.find((l) => snap.regions[l.r].kind === 'main');
  if (main) return main.n - 1;
  const plain = snap.lines.find((l) => snap.regions[l.r].kind === 'content');
  return plain ? plain.n - 1 : 0;
}

/**
 * Open dialogs block the page, so they are announced before anything else.
 * @param {Snapshot} snap
 */
function dialogs(snap) {
  const runs = chrome(snap).filter(([, , r]) => snap.regions[r].kind === 'dialog');
  if (runs.length === 0) return [];
  return [
    `Note: a dialog is open (${runs.map(([a, b, r]) => `${label(snap, r)}, lines ${a}-${b}`).join('; ')}). Links still work; close it with its button if it gets in the way.`,
  ];
}

/**
 * The last line of a view that reaches the bottom of the page. A list that goes on elsewhere
 * says so, because a small model otherwise reports "not on the page" and stops.
 * @param {Snapshot} snap
 */
function end(snap) {
  const [next] = onward(snap);
  return next ? `(end of page; ${next})` : '(end of page)';
}

/**
 * Numbered page links on one line ("1 2 3 … 24"), as `[number, id]` pairs.
 * @param {Snapshot} snap
 */
function pages(snap) {
  for (const line of snap.lines) {
    const found = [...line.t.matchAll(/(?:^|\s)(\d{1,4}) \[(\d+)\]/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    if (found.length >= 3 && found.every(([n], i) => i === 0 || n > found[i - 1][0])) return found;
  }
  return [];
}

/**
 * Ways to look further than the open page, as phrases: its link to a following page, then the
 * site's search field.
 * @param {Snapshot} snap
 * @param {boolean} [search]   include the search field
 */
export function onward(snap, search = false) {
  const out = [];
  const nexts = snap.targets.filter((t) => t.next);
  const numbered = pages(snap);
  // Several "next" links belong to separate items ("Continue reading" under each teaser).
  // These are stated as facts, not as orders: told to click, a small model keeps paging.
  if (nexts.length === 1) out.push(`next page: "${nexts[0].label}" [${nexts[0].id}]`);
  else if (numbered.length > 0) {
    const show = numbered.length > 5 ? [...numbered.slice(0, 4), numbered.at(-1)] : numbered;
    const list = show.map(([n, id]) => `${n} [${id}]`);
    if (numbered.length > 5) list.splice(4, 0, '…');
    out.push(`other pages: ${list.join(', ')}`);
  }
  const field = snap.targets.find(
    (t) => t.kind === 'searchbox' || (t.kind === 'textbox' && /search|find/i.test(t.label)),
  );
  if (search && field) {
    out.push(`the site has a search field: "${field.label}" [${field.id} ${field.kind}]`);
  }
  return out;
}

/**
 * The first look at a page.
 * @param {Snapshot} snap
 * @param {{ budget: number }} opts
 */
export function overview(snap, { budget }) {
  const total = snap.lines.length;
  const head = [banner(snap), ...dialogs(snap)];
  if (snap.note) head.push(`Note: ${snap.note}`);
  if (total === 0) return [...head, 'The page has no readable text.'].join('\n');

  const whole = body(snap, 0, total);
  if (whole.join('\n').length <= budget) {
    return [...head, `Whole page, ${total} lines:`, ...whole, end(snap)].join('\n');
  }

  const heads = outline(snap);
  const parts = chrome(snap)
    .filter(([, , r]) => snap.regions[r].kind !== 'dialog')
    .map(([a, b, r]) => `${a === b ? a : `${a}-${b}`} ${label(snap, r)}`);
  const top = [
    ...head,
    heads.length > 0
      ? `Long page: ${total} lines. Showing the outline and the start of the main content.`
      : `Long page: ${total} lines. Showing the first part.`,
  ];
  if (heads.length > 0) top.push('Outline (line| heading):', ...heads.map((h) => `  ${show(h)}`));
  if (parts.length > 0) top.push(`Other parts (lines): ${parts.join(' · ')}`);

  const from = start(snap);
  const left = Math.max(budget - top.join('\n').length, Math.floor(budget / 3));
  const to = fit(snap, from, left);
  return [
    ...top,
    `Lines ${from + 1}-${to} of ${total}:`,
    ...body(snap, from, to),
    to < total
      ? `(more below. Fastest: find_in_page with words from the question, or read_page at the line of a heading. To continue from here: read_page with line ${to + 1}.)`
      : end(snap),
  ].join('\n');
}

/**
 * A stretch of the page starting at a given line.
 * @param {Snapshot} snap
 * @param {number} line   1-based
 * @param {{ budget: number }} opts
 */
export function slice(snap, line, { budget }) {
  const total = snap.lines.length;
  if (total === 0) return `${banner(snap)}\nThe page has no readable text.`;
  const from = Math.min(Math.max(Math.trunc(line) || 1, 1), total) - 1;
  const to = fit(snap, from, budget);
  const tail =
    to < total ? `(more below. To read on, call read_page with line ${to + 1}.)` : end(snap);
  const note = line > total ? [`The page has only ${total} lines; showing the last one.`] : [];
  return [
    banner(snap),
    ...note,
    `Lines ${from + 1}-${to} of ${total}:`,
    ...body(snap, from, to),
    tail,
  ].join('\n');
}

/**
 * What an action changed when the page stayed the same document: lines that appeared and
 * lines that went away. Null when too much changed to list.
 * @param {Snapshot} before
 * @param {Snapshot} after
 */
export function changes(before, after, limit = 24) {
  const count = (lines) => {
    const seen = new Map();
    for (const l of lines) seen.set(l.t, (seen.get(l.t) ?? 0) + 1);
    return seen;
  };
  const was = count(before.lines);
  const now = count(after.lines);
  const added = after.lines.filter((l) => {
    const n = was.get(l.t) ?? 0;
    if (n > 0) was.set(l.t, n - 1);
    return n === 0;
  });
  const removed = before.lines.filter((l) => {
    const n = now.get(l.t) ?? 0;
    if (n > 0) now.set(l.t, n - 1);
    return n === 0;
  });
  if (added.length === 0 && removed.length === 0) return UNCHANGED;
  if (added.length + removed.length > limit) return null;
  const out = [];
  if (added.length > 0) out.push('New or changed lines:', ...added.map(show));
  if (removed.length > 0) out.push('Lines that went away:', ...removed.map((l) => `  ${l.t}`));
  return out.join('\n');
}
