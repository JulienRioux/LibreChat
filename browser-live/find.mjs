// Find-in-page for a page snapshot. Ranks lines by the words they share with the query,
// counting the headings a line sits under and the caption of its table, so a value is found
// even when its label is on another line.
import { banner, onward, outline } from './view.mjs';

/** @typedef {import('./snapshot.mjs').Snapshot} Snapshot */
/** @typedef {import('./snapshot.mjs').Line} Line */

const STOP = new Set(
  'a an the of to in on at for and or is are was were be been by with from as it its this that these those what which who whom whose how many much does do did has have had there their about into than then'.split(
    ' ',
  ),
);

/** A light English stemmer: enough to match plurals and common verb endings. */
export function stem(word) {
  if (/^\d/.test(word) || word.length < 4) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(sses|ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  return word;
}

/**
 * Words of a text, lower-cased and stemmed. Digit groups are joined so `3,912,480` and
 * `3912480` are the same word.
 */
export function words(text, keep = false) {
  const flat = String(text)
    .toLowerCase()
    .replace(/(\d)[,\u00a0\u202f](?=\d{3}(\D|$))/g, '$1')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const out = [];
  for (const raw of flat.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (!keep && STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

const bare = (text) => text.replace(/\[\d+[^\]]*\]/g, ' ');

/** How well a query word matches a word on the page: exact, or one a prefix of the other. */
function match(q, t) {
  if (q === t) return 1;
  if (q.length >= 4 && t.length >= 4 && (t.startsWith(q) || q.startsWith(t))) return 0.6;
  return 0;
}

/**
 * For every line: its own words, and the words of its surroundings (headings above it,
 * table caption and column names, the paths of links on it).
 * @param {Snapshot} snap
 */
function index(snap) {
  const paths = new Map(snap.targets.filter((t) => t.href).map((t) => [t.id, t.href]));
  const heads = [];
  let caption = '';
  let region = -1;
  return snap.lines.map((line) => {
    // A heading only speaks for the lines of its own part of the page.
    if (line.r !== region) heads.length = 0;
    region = line.r;
    if (line.k === 'h') {
      while (heads.length > 0 && (heads.at(-1).lv ?? 1) >= (line.lv ?? 1)) heads.pop();
      heads.push(line);
    }
    if (line.k === 'cap') caption = line.t;
    else if (line.k !== 'row') caption = '';
    const above = heads.filter((h) => h !== line);
    const around = [above.map((h) => h.t).join(' '), caption];
    for (const m of line.t.matchAll(/\[(\d+)/g)) {
      const href = paths.get(Number(m[1]));
      if (href) around.push(href.replace(/^https?:\/\/[^/]+/, ''));
    }
    return {
      line,
      own: words(bare(line.t)),
      near: words(bare(around.join(' '))),
      under: above.at(-1),
    };
  });
}

/**
 * @param {Snapshot} snap
 * @param {string} query
 * @param {{ budget: number, limit?: number }} opts
 */
export function find(snap, query, { budget, limit = 8 }) {
  const asked = String(query ?? '').trim();
  if (!asked) return 'Give one or more words to search for, for example find("price").';
  let terms = [...new Set(words(asked))];
  if (terms.length === 0) terms = [...new Set(words(asked, true))];
  const phrases = [...asked.matchAll(/"([^"]{3,})"/g)].map((m) => m[1].toLowerCase());
  const whole = asked.replace(/"/g, '').toLowerCase();
  const rows = index(snap);
  const total = rows.length;
  if (total === 0) return `${banner(snap)}\nThe page has no readable text.`;

  const mean = rows.reduce((n, r) => n + r.own.length, 0) / total || 1;
  const seen = terms.map((q) =>
    rows.reduce((n, r) => n + (r.own.some((t) => match(q, t) > 0) ? 1 : 0), 0),
  );
  const weight = seen.map((df) => Math.log(1 + (total - df + 0.5) / (df + 0.5)));

  const scored = [];
  for (const row of rows) {
    let score = 0;
    let hit = 0;
    terms.forEach((q, i) => {
      let tf = 0;
      for (const t of row.own) tf += match(q, t);
      if (tf > 0) {
        hit++;
        score += (weight[i] * (tf * 2.2)) / (tf + 1.2 * (0.25 + (0.75 * row.own.length) / mean));
        return;
      }
      if (row.near.some((t) => match(q, t) > 0)) {
        hit += 0.5;
        score += weight[i] * 0.35;
      }
    });
    if (score === 0) continue;
    const text = row.line.t.toLowerCase();
    score *= 0.5 + (0.5 * hit) / terms.length;
    if (row.line.k === 'h') score *= 1.3;
    if (terms.length > 1 && text.includes(whole)) score *= 1.5;
    if (phrases.some((p) => text.includes(p))) score *= 1.5;
    scored.push({ row, score, cover: hit / terms.length });
  }

  // Looking elsewhere is only the next step once the whole page has been seen. On a long page
  // the answer is more likely further down, under words the query did not use.
  const fits = snap.lines.reduce((n, l) => n + l.t.length + 8, 0) <= budget;
  const ways = onward(snap, fits);
  if (scored.length === 0) {
    const heads = outline(snap, 30);
    return [
      banner(snap),
      `No line on this page matches "${asked}".`,
      'Try other words for the same thing (a synonym, a shorter word, a name or a number).',
      ...(heads.length > 0
        ? ['Sections of the page (line| heading):', ...heads.map((h) => `  ${h.n}| ${h.t}`)]
        : []),
      fits
        ? ways.length > 0
          ? `If it is not on this page: ${ways.join('; ')}.`
          : 'If it is not on this page, open another page.'
        : 'Next: call find_in_page with another word, or read_page at the line of the section most likely to hold it.',
    ].join('\n');
  }

  scored.sort((a, b) => b.score - a.score || a.row.line.n - b.row.line.n);
  const floor = scored[0].score * 0.3;
  const best = scored.filter((s) => s.score >= floor).slice(0, limit);

  // A heading that matches is shown with the lines it introduces.
  const picked = new Map();
  for (const { row } of best) {
    picked.set(row.line.n, row);
    if (row.line.k !== 'h') continue;
    for (let n = row.line.n; n < Math.min(row.line.n + 2, total); n++) {
      if (rows[n].line.k === 'h') break;
      picked.set(rows[n].line.n, rows[n]);
    }
  }

  const order = [...picked.values()].sort((a, b) => a.line.n - b.line.n);
  const rank = new Map(best.map((s, i) => [s.row.line.n, i]));
  const blocks = [];
  for (const row of order) {
    const last = blocks.at(-1);
    if (last && row.line.n - last.at(-1).line.n <= 1) last.push(row);
    else blocks.push([row]);
  }
  const first = (block) => Math.min(...block.map((r) => rank.get(r.line.n) ?? limit));
  blocks.sort((a, b) => first(a) - first(b));

  // Lines that share only a word or two with a longer query are not what was asked for.
  const weak = terms.length >= 2 && scored[0].cover < 0.6;
  const out = [
    banner(snap),
    weak
      ? `No line has all the words of "${asked}". The closest lines (the page has ${total} lines):`
      : `Best matches for "${asked}" (the page has ${total} lines):`,
  ];
  let used = out.join('\n').length;
  let shown = 0;
  fill: for (const block of blocks) {
    const under = block[0].under;
    let intro = under ? `under ${under.t.replace(/^#+ /, '"')}" (line ${under.n}):` : '';
    for (const row of block) {
      const text = row.line.t;
      const line = `${row.line.n}| ${text.length > 520 ? `${text.slice(0, 520)}…` : text}`;
      const cost = line.length + intro.length + 2;
      if (shown > 0 && used + cost > budget) break fill;
      if (intro) out.push(intro);
      intro = '';
      out.push(line);
      used += cost;
      shown++;
    }
  }
  out.push(
    'Ids in brackets can be clicked. To read around a match, call read_page with its line number.',
    ...(weak && fits && ways.length > 0 ? [`If it is not on this page: ${ways.join('; ')}.`] : []),
    ...(weak && !fits
      ? ['If these are not it, try find_in_page with another word, or read_page at a section.']
      : []),
  );
  return out.join('\n');
}
