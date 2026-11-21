// Turns the open page into numbered lines of text that a small model can read and act on:
// headings, lists and tables keep their shape, and every link and control carries a short id.

/**
 * @typedef {object} Line
 * @property {number} n   1-based line number
 * @property {string} t   text, with ids inline after the name: `Travel [3]`, `Search [4 button]`
 * @property {'h'|'p'|'li'|'links'|'row'|'kv'|'cap'|'ctl'|'code'} k
 * @property {number} r   index into `regions`
 * @property {number} [lv]   heading level
 * @property {string[]} [head]   column names, on table rows
 * @property {string[]} [cells]
 * @property {boolean} [cont]   continues the previous line's paragraph
 *
 * @typedef {object} Target
 * @property {number} id
 * @property {string} kind   link, button, frame, textbox, searchbox, select, checkbox, ...
 * @property {string} label
 * @property {string} [href]
 * @property {boolean} [next]   leads to the next page of a list
 *
 * @typedef {object} Snapshot
 * @property {string} url
 * @property {string} title
 * @property {string} doc   changes when a new document is loaded
 * @property {Line[]} lines
 * @property {Target[]} targets
 * @property {{ kind: string, label: string }[]} regions
 * @property {string} [note]
 */

/**
 * Runs inside the page, so it cannot use anything from this module's scope.
 * @param {{ join: number, wrap: number }} opts
 */
export function scan(opts) {
  const JOIN = opts.join;
  const WRAP = opts.wrap;
  const state = (window.__bl ??= {
    ids: new WeakMap(),
    hrefs: new Map(),
    els: new Map(),
    next: 1,
    doc: Math.random().toString(36).slice(2),
  });

  const SKIP = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'HEAD',
    'LINK',
    'META',
    'SVG',
    'CANVAS',
    'VIDEO',
    'AUDIO',
    'OBJECT',
    'EMBED',
    'IMG',
    'PICTURE',
    'MAP',
    'IFRAME',
  ]);
  const GENERIC =
    /^(next|previous|prev|back|more|read more|show more|see more|see all|view all|continue|continue reading|here|link|details|view|open|older|newer|first|last|[<>«»‹›→←]+)$/i;
  const ITEM_ROLES = new Set(['link', 'tab', 'menuitem', 'option', 'treeitem']);
  const FIELD_ROLES = new Set(['button', 'switch', 'checkbox', 'combobox', 'textbox', 'searchbox']);

  const clean = (s) =>
    (s || '')
      .replace(/[\u200b-\u200d\ufeff\u00ad]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  /** Brackets around a number mean an id here, so the page's own "[12]" becomes "(12)". */
  const plain = (s) => s.replace(/\[(\d[^\]]{0,24})\]/g, '($1)');
  const RATED = /(^|[\s_-])(stars?|rating|rated|score)([\s_-]|$)/i;
  /** Stands in for the spaces inside a link or control, so a line break never splits one. */
  const GLUE = '\uE000';
  const stick = (s) => s.replace(/ /g, GLUE);
  const loose = (s) => s.replaceAll(GLUE, ' ');

  /** @type {any[]} */
  const out = [];
  const targets = new Map();
  const regions = [{ kind: 'content', label: '' }];
  let region = 0;
  let buf = '';

  const flush = (kind = 'p') => {
    const t = clean(buf).replace(/\] (?=[.,;:!?)])/g, ']');
    buf = '';
    if (t) out.push({ t, k: kind, r: region });
  };

  const visible = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    }
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };

  // An image link next to a text link to the same place would only repeat the title.
  const worded = new Set();
  for (const a of document.querySelectorAll('a[href]')) if (clean(a.innerText)) worded.add(a.href);

  const NEXT =
    /^(next|next page|older|older posts|more results|load more|show more|continue|continue reading)?$/i;
  /** "Next »", "→" and "Continue reading" all lead to the following page. */
  const onward = (label) =>
    /[\p{L}›»→>]/u.test(label) && NEXT.test(label.replace(/[\s›»→>]+/g, ' ').trim());
  /** Links to the same address share an id; `shared` is false for things that must not. */
  const idFor = (el, kind, label, href, shared = true) => {
    let id = href && shared ? state.hrefs.get(href) : undefined;
    if (id == null) {
      id = state.ids.get(el);
      if (id == null) {
        id = state.next++;
        state.ids.set(el, id);
      }
      if (href && shared) state.hrefs.set(href, id);
      state.els.set(id, new WeakRef(el));
    } else if (!state.els.get(id)?.deref()?.isConnected) {
      state.els.set(id, new WeakRef(el));
    }
    const known = targets.get(id);
    if (!known || label.length > known.label.length)
      targets.set(id, {
        id,
        kind,
        label,
        ...(href ? { href } : {}),
        ...(href &&
        href !== location.href &&
        (onward(label) || /(^|\s)next(\s|$)/i.test(el.getAttribute('rel') || ''))
          ? { next: true }
          : {}),
      });
    return id;
  };

  /** A name for a control that has none: the words in its id, name or class. */
  const hint = (el) => {
    const raw =
      el.getAttribute('data-testid') ||
      el.id ||
      el.getAttribute('name') ||
      (el.getAttribute('class') || '').split(/\s+/)[0] ||
      '';
    return clean(raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ')).toLowerCase();
  };

  const named = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = clean(
        by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
      if (text) return text;
    }
    return clean(el.getAttribute('aria-label'));
  };

  const linkLabel = (a) => {
    let text = clean(a.innerText);
    const title = clean(a.getAttribute('title'));
    if (title && /(\.\.\.|…)$/.test(text) && title.length > text.length) text = title;
    if (!text)
      text =
        named(a) ||
        title ||
        clean(a.querySelector('img[alt]')?.getAttribute('alt')) ||
        clean(a.querySelector('svg title')?.textContent);
    return plain(clip(text, 160));
  };

  const fieldLabel = (el) => {
    const own = named(el);
    if (own) return own;
    const label = el.labels?.[0];
    if (label) {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input,select,textarea,button').forEach((c) => c.remove());
      const text = clean(copy.textContent);
      if (text) return text;
    }
    return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || hint(el);
  };

  const control = (el) => {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role') || '';
    const flags = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') flags.push('disabled');
    if (el.required) flags.push('required');
    let kind;
    let label;
    let value = '';
    if (tag === 'SELECT') {
      kind = 'select';
      label = fieldLabel(el);
      const names = [...el.options].map((o) => clean(o.textContent)).filter(Boolean);
      value = clean(el.selectedOptions?.[0]?.textContent);
      flags.unshift(
        `options: ${names.slice(0, 12).join(', ')}${names.length > 12 ? `, +${names.length - 12} more` : ''}`,
      );
    } else if (tag === 'INPUT' && !['submit', 'button', 'reset', 'image'].includes(type)) {
      kind =
        {
          checkbox: 'checkbox',
          radio: 'radio',
          search: 'searchbox',
          range: 'slider',
          file: 'file',
          password: 'password',
        }[type] || 'textbox';
      label = fieldLabel(el);
      if (kind === 'checkbox' || kind === 'radio') {
        if (el.checked) flags.unshift('checked');
      } else if (kind !== 'password' && kind !== 'file') {
        value = clip(clean(el.value), 60);
      }
    } else if (
      tag === 'TEXTAREA' ||
      el.isContentEditable ||
      role === 'textbox' ||
      role === 'searchbox'
    ) {
      kind = 'textbox';
      label = fieldLabel(el);
      value = clip(clean(el.value ?? el.textContent), 60);
    } else {
      kind = role === 'checkbox' || role === 'switch' ? 'checkbox' : 'button';
      label = clip(
        clean(el.innerText) ||
          clean(el.value) ||
          named(el) ||
          clean(el.getAttribute('title')) ||
          clean(el.querySelector('img[alt]')?.getAttribute('alt')) ||
          hint(el),
        80,
      );
      if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true')
        flags.unshift('checked');
      if (el.getAttribute('aria-expanded') === 'true') flags.push('expanded');
    }
    label = plain(label);
    const id = idFor(el, kind, label);
    let text = `${label} [${id} ${kind}`;
    if (value) text += ` = "${value}"`;
    if (flags.length) text += `; ${flags.join('; ')}`;
    return `${text}]`.trim();
  };

  const landmark = (el) => {
    const tag = el.tagName;
    const role = el.getAttribute('role');
    if (
      role === 'dialog' ||
      role === 'alertdialog' ||
      el.getAttribute('aria-modal') === 'true' ||
      (tag === 'DIALOG' && el.open)
    )
      return 'dialog';
    if (role === 'main' || tag === 'MAIN') return 'main';
    if (role === 'navigation' || tag === 'NAV') return 'nav';
    if (role === 'complementary' || tag === 'ASIDE') return 'aside';
    const nested = () => el.parentElement?.closest('article,section,main,aside,nav') != null;
    if (role === 'banner' || (tag === 'HEADER' && !nested())) return 'header';
    if (role === 'contentinfo' || (tag === 'FOOTER' && !nested())) return 'footer';
    return null;
  };

  const strip = (t) => t.replace(/^\s*(#+|-) /, '');
  const size = (lines) => lines.reduce((n, l) => n + l.t.length + 3, 0);

  /** A sentence, as opposed to a fragment such as a price, a label or a byline. */
  const prose = (t) => /[.!?]["')]?$/.test(t) && t.split(/[ \uE000]/).length >= 5;
  /** Short sibling fragments (a product card, a byline, a toolbar) read better as one line. */
  const fold = (start) => {
    const mine = out.slice(start);
    if (mine.length < 2 || mine.length > 8 || size(mine) > JOIN) return;
    const ok = mine.every(
      (l) =>
        l.r === mine[0].r &&
        !l.solo &&
        !prose(l.t) &&
        (l.k === 'p' ||
          l.k === 'li' ||
          l.k === 'ctl' ||
          l.k === 'links' ||
          (l.k === 'h' && l.lv > 2)),
    );
    if (!ok) return;
    out.splice(start, mine.length, {
      t: mine.map((l) => strip(l.t)).join(' · '),
      k: 'p',
      r: mine[0].r,
    });
  };

  /** A list of short items (a menu, tags, a table of contents) becomes a few lines. */
  const menu = (start, counts) => {
    const mine = out.slice(start);
    if (mine.length < 3 || counts.length !== mine.length || counts.some((c) => c !== 1)) return;
    const linked = mine.every((l) => l.k === 'li' && l.t.length <= 64 && /\[\d+/.test(l.t));
    const brief = mine.length >= 6 && mine.every((l) => l.k === 'li' && l.t.length <= 48);
    if (!linked && !brief) return;
    const rows = [];
    let cur = '';
    for (const l of mine) {
      const item = strip(l.t);
      if (cur && cur.length + item.length + 3 > WRAP) {
        rows.push(cur);
        cur = '';
      }
      cur = cur ? `${cur} · ${item}` : item;
    }
    if (cur) rows.push(cur);
    out.splice(start, mine.length, ...rows.map((t) => ({ t, k: 'links', r: mine[0].r })));
  };

  /** Marks the lines `from..to` as one list item: a bullet, then indented lines. */
  const item = (from, bullet, to = out.length) => {
    const first = out[from];
    if (first.k === 'p' || first.k === 'links') {
      first.t = bullet + first.t;
      first.k = 'li';
    }
    for (let i = from + 1; i < to; i++) {
      if (out[i].k === 'p' || out[i].k === 'li' || out[i].k === 'links' || out[i].k === 'kv')
        out[i].t = `  ${out[i].t}`;
    }
  };

  const RECORD = new Set(['DIV', 'ARTICLE', 'SECTION', 'FIGURE']);
  /**
   * Repeated sibling blocks with the same class are the items of a list that was not marked up
   * as one: product cards, search results, quotes. They are numbered like list items, so "the
   * second result" can be found and each item's lines stay together.
   */
  const records = (nodes) => {
    const found = new Set();
    let run = [];
    let key = '';
    const close = () => {
      if (run.length >= 3) for (const c of run) found.add(c);
      run = [];
    };
    for (const c of nodes) {
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toUpperCase();
      const cls = (c.getAttribute('class') || '').trim();
      const sig =
        (RECORD.has(tag) || tag.includes('-')) && (cls || tag === 'ARTICLE') ? `${tag} ${cls}` : '';
      if (sig && sig === key) run.push(c);
      else {
        close();
        key = sig;
        run = sig ? [c] : [];
      }
    }
    close();
    for (const c of found) if (getComputedStyle(c).display.startsWith('inline')) found.delete(c);
    return found.size >= 3 ? found : null;
  };

  /** The text of a subtree as one string, without leaving lines behind. */
  const inner = (nodes) => {
    const saved = buf;
    const mark = out.length;
    buf = '';
    for (const c of nodes) walk(c);
    flush();
    const text = out
      .splice(mark)
      .map((l) => strip(l.t))
      .join(' ');
    buf = saved;
    return text;
  };

  const table = (el) => {
    flush();
    const rows = [...el.rows].filter(visible);
    const role = el.getAttribute('role');
    const data =
      role !== 'presentation' &&
      role !== 'none' &&
      (role === 'table' || role === 'grid' || el.querySelector('th,caption,thead') != null);
    if (!data) {
      // A layout table: each row is just a line.
      for (const row of rows) {
        const start = out.length;
        for (const cell of row.cells) {
          for (const c of cell.childNodes) walk(c);
          buf += ' ';
        }
        flush();
        fold(start);
        // Rows stay separate lines: each is its own record.
        for (let i = start; i < out.length; i++) out[i].solo = true;
      }
      return;
    }
    const caption = clean(el.caption?.innerText);
    if (caption) out.push({ t: `Table: ${caption}`, k: 'cap', r: region });
    const grid = rows.map((row) => ({
      cells: [...row.cells].map((c) => loose(inner(c.childNodes)).replace(/\|/g, '/')),
      th: [...row.cells].map((c) => c.tagName === 'TH'),
    }));
    const top = grid.find((g) => g.cells.length >= 2 && g.th.every(Boolean));
    const head = top?.cells;
    for (const g of grid) {
      const cells = g.cells;
      if (cells.every((c) => !c)) continue;
      // The header row is not printed: every row below carries the column names with its
      // values, which a small model reads far more reliably than values by position.
      if (g === top) continue;
      if (!head && cells.length === 2 && g.th[0] && !g.th[1])
        out.push({ t: `${cells[0]}: ${cells[1]}`, k: 'kv', r: region });
      else if (cells.length === 1) out.push({ t: cells[0], k: 'p', r: region });
      else if (head?.length === cells.length)
        out.push({
          t: cells
            .map((c, i) => (c && head[i] ? `${head[i]}: ${c}` : c))
            .filter(Boolean)
            .join(' | '),
          k: 'row',
          r: region,
          cells,
          head,
        });
      else out.push({ t: `| ${cells.join(' | ')} |`, k: 'row', r: region, cells });
    }
  };

  function walk(node) {
    if (node.nodeType === 3) {
      buf += plain(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toUpperCase();
    if (tag === 'IFRAME') {
      // What a frame shows is another document. It appears as something to open; frames too
      // small to hold content (trackers) and advertising frames are left out.
      const box = el.getBoundingClientRect();
      const src = el.src || '';
      if (!/^https?:/i.test(src) || box.width < 200 || box.height < 80 || !visible(el)) return;
      if (/doubleclick|googlesyndication|adservice|\/ads?[/.]/i.test(src)) return;
      const label = plain(
        clip(
          `${clean(el.getAttribute('title')) || 'embedded page'} (open it to read what it shows)`,
          110,
        ),
      );
      const u = new URL(src);
      const where = u.host !== location.host ? u.host.replace(/^www\./, '') : u.pathname + u.search;
      flush();
      out.push({
        t: stick(`${label} [${idFor(el, 'frame', label, src, false)} frame: ${where}]`),
        k: 'p',
        r: region,
      });
      return;
    }
    if (SKIP.has(tag)) {
      // An svg that is an image with a name says what it shows.
      if (tag === 'SVG' && el.getAttribute('role') === 'img' && visible(el)) {
        const tip = named(el) || clean(el.querySelector('title')?.textContent);
        if (tip) buf += ` (${plain(clip(tip, 80))}) `;
      }
      return;
    }
    if (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return;
    if (!visible(el)) return;
    if (tag === 'BR') {
      flush();
      return;
    }

    const role = el.getAttribute('role') || '';
    if (tag === 'A' && el.hasAttribute('href')) {
      const raw = el.getAttribute('href') || '';
      if (!clean(el.innerText) && worded.has(el.href)) return;
      const label = linkLabel(el);
      if (!label) return;
      if (raw.startsWith('#') || raw === '') {
        // "#section" that points at something visible only scrolls: plain text, and a footnote
        // marker (inside <sup>) is dropped. Any other "#" link is run by a script, so it is a
        // control: a tab, a "load more", a year to choose.
        const goal =
          raw.length > 1 ? document.getElementById(decodeURIComponent(raw.slice(1))) : null;
        const scripted =
          goal == null ||
          !visible(goal) ||
          role !== '' ||
          el.hasAttribute('onclick') ||
          el.hasAttribute('aria-controls') ||
          el.hasAttribute('data-toggle') ||
          el.hasAttribute('data-bs-toggle');
        if (scripted)
          buf += ` ${stick(`${clip(label, 80)} [${idFor(el, 'button', label)} button]`)} `;
        else if (el.closest('sup') == null) buf += ` ${label} `;
        return;
      }
      if (/^javascript:/i.test(raw)) {
        buf += ` ${stick(`${clip(label, 80)} [${idFor(el, 'button', label)} button]`)} `;
        return;
      }
      const href = el.href;
      let where = '';
      try {
        const u = new URL(href);
        if (u.host !== location.host) where = `: ${u.host.replace(/^www\./, '')}`;
        else if (GENERIC.test(label)) where = `: ${u.pathname}${u.search}`;
      } catch {
        /* keep the bare id */
      }
      buf += ` ${stick(`${label} [${idFor(el, 'link', label, href)}${where}]`)} `;
      return;
    }
    if (tag === 'SUMMARY' || ITEM_ROLES.has(role)) {
      const label = clip(clean(el.innerText) || named(el) || hint(el), 80);
      if (label)
        buf += ` ${stick(`${label} [${idFor(el, 'button', label)} ${role || 'button'}]`)} `;
      return;
    }
    if (
      tag === 'BUTTON' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      tag === 'INPUT' ||
      FIELD_ROLES.has(role) ||
      (el.isContentEditable && !el.parentElement?.isContentEditable)
    ) {
      buf += ` ${stick(control(el))} `;
      return;
    }
    if (tag === 'TABLE') {
      table(el);
      return;
    }

    if (tag === 'LABEL' && el.control && visible(el.control)) {
      // The control prints its own label; printing the label text too would say it twice.
      for (const c of el.querySelectorAll('input,select,textarea,button')) walk(c);
      return;
    }
    // Some facts exist only as an attribute: a star rating as a class name, an icon's meaning as a title.
    if (
      role === 'img' ||
      el.hasAttribute('aria-label') ||
      el.hasAttribute('title') ||
      RATED.test(el.getAttribute('class') || '')
    ) {
      if (
        !clean(el.textContent) &&
        el.querySelector('a[href],button,input,select,textarea') == null
      ) {
        const tip =
          named(el) ||
          clean(el.getAttribute('title')) ||
          clean((el.getAttribute('class') || '').replace(/[-_]+/g, ' '));
        if (tip) buf += ` (${plain(clip(tip, 80))}) `;
        return;
      }
    }

    const style = getComputedStyle(el);
    const inline = style.display.startsWith('inline') || style.display === 'contents';
    // Clickable things that are not links or buttons, such as a div with a click handler.
    if (style.cursor === 'pointer' && tag !== 'LABEL' && tag !== 'BODY' && tag !== 'HTML') {
      const top =
        el.parentElement == null || getComputedStyle(el.parentElement).cursor !== 'pointer';
      const label = top ? clean(el.innerText) : '';
      if (
        label &&
        label.length <= 80 &&
        el.querySelector('a[href],button,input,select,textarea') == null
      ) {
        if (!inline) flush();
        buf += ` ${stick(`${label} [${idFor(el, 'button', label)} button]`)} `;
        if (!inline) flush('ctl');
        return;
      }
    }

    const kids = el.shadowRoot
      ? el.shadowRoot.childNodes
      : tag === 'SLOT'
        ? el.assignedNodes({ flatten: true })
        : el.childNodes;
    // A heading is a heading however a site lays it out; some set it inline next to an edit link.
    const heading = /^H[1-6]$/.test(tag) || role === 'heading';
    if (inline && !heading) {
      for (const c of kids) walk(c);
      return;
    }

    flush();
    const mark = landmark(el);
    const outer = region;
    if (mark && (mark === 'dialog' || regions[region].kind === 'content')) {
      regions.push({ kind: mark, label: clip(named(el), 40) });
      region = regions.length - 1;
    }
    const start = out.length;

    if (heading) {
      const lv = /^H[1-6]$/.test(tag) ? Number(tag[1]) : Number(el.getAttribute('aria-level')) || 2;
      const t = inner(kids);
      if (t) out.push({ t: `${'#'.repeat(lv)} ${t}`, k: 'h', lv, r: region });
    } else if (tag === 'PRE') {
      for (const row of el.innerText.split('\n')) {
        if (row.trim()) out.push({ t: row.replace(/\s+$/, ''), k: 'code', r: region });
      }
    } else if (tag === 'UL' || tag === 'OL' || tag === 'MENU') {
      const counts = [];
      let index = tag === 'OL' ? Number(el.getAttribute('start')) || 1 : 0;
      for (const c of kids) {
        if (c.nodeType !== 1 || c.tagName !== 'LI') {
          walk(c);
          continue;
        }
        if (!visible(c)) continue;
        const from = out.length;
        for (const g of c.childNodes) walk(g);
        flush();
        fold(from);
        const made = out.length - from;
        if (made > 0) {
          item(from, tag === 'OL' ? `${index}. ` : '- ');
          counts.push(made);
        }
        index++;
      }
      flush();
      menu(start, counts);
      fold(start);
    } else if (tag === 'DL') {
      let term = '';
      for (const c of kids) {
        if (c.nodeType !== 1) continue;
        const text = inner(c.childNodes);
        if (!text) continue;
        if (c.tagName === 'DT') {
          if (term) out.push({ t: term, k: 'p', r: region });
          term = text;
        } else {
          out.push({ t: term ? `${term}: ${text}` : text, k: term ? 'kv' : 'p', r: region });
          term = '';
        }
      }
      if (term) out.push({ t: term, k: 'p', r: region });
    } else {
      const listed = records(kids);
      const spans = [];
      for (const c of kids) {
        if (!listed?.has(c)) {
          walk(c);
          continue;
        }
        flush();
        const from = out.length;
        walk(c);
        flush();
        if (out.length > from) spans.push([from, out.length]);
      }
      flush();
      // Layout rows share a class too. Blocks are numbered only when they look alike: each
      // starts with plain text and names something that can be opened or used.
      const alike =
        spans.length >= 3 &&
        spans.every(([a, b]) => out[a].k === 'p' && out.slice(a, b).some((l) => /\[\d+/.test(l.t)));
      if (alike) {
        spans.forEach(([a, b], i) => {
          item(a, `${i + 1}. `, b);
          // Each record keeps its own lines, however short.
          for (let k = a; k < b; k++) out[k].solo = true;
        });
      }
      // The page's top-level blocks are separate things; only smaller containers are folded.
      if (tag !== 'BODY' && tag !== 'MAIN') fold(start);
    }
    region = outer;
  }

  walk(document.body ?? document.documentElement);
  flush();

  // Long paragraphs become several lines, so a search hit returns a sentence, not a wall of text.
  const lines = [];
  for (const l of out) {
    if (l.k !== 'p' && l.k !== 'li') {
      lines.push(l);
      continue;
    }
    let rest = l.t;
    let cont = false;
    while (rest.length > WRAP) {
      const part = rest.slice(0, WRAP);
      let cut =
        Math.max(part.lastIndexOf('. '), part.lastIndexOf('? '), part.lastIndexOf('! ')) + 1;
      if (cut < WRAP * 0.4) {
        cut = -1;
        for (let i = part.length - 1; i > 0; i--) {
          if (part[i] === ' ' && rest[i + 1] !== '[') {
            cut = i;
            break;
          }
        }
      }
      if (cut <= 0) cut = WRAP;
      lines.push({ ...l, t: rest.slice(0, cut).trimEnd(), ...(cont ? { cont: true } : {}) });
      rest = rest.slice(cut).trimStart();
      cont = true;
    }
    if (rest) lines.push({ ...l, t: rest, ...(cont ? { cont: true } : {}) });
  }
  lines.forEach((l, i) => {
    l.n = i + 1;
    l.t = loose(l.t);
    delete l.solo;
  });

  return {
    url: location.href,
    title: clean(document.title),
    doc: state.doc,
    lines,
    targets: [...targets.values()].sort((a, b) => a.id - b.id),
    regions,
  };
}

/**
 * Finds the element behind an id from the latest scan. Runs inside the page.
 * @param {number} id
 */
export function locate(id) {
  const state = window.__bl;
  if (!state) return null;
  const el = state.els.get(id)?.deref();
  if (el?.isConnected) return el;
  for (const [href, known] of state.hrefs) {
    if (known === id)
      return [...document.querySelectorAll('a[href]')].find((a) => a.href === href) ?? null;
  }
  return null;
}

/** @type {Snapshot} */
const EMPTY = {
  url: 'about:blank',
  title: '',
  doc: '',
  lines: [],
  targets: [],
  regions: [{ kind: 'content', label: '' }],
};

/**
 * @param {import('playwright-core').Page} page
 * @param {{ join?: number, wrap?: number }} [opts]
 * @returns {Promise<Snapshot>}
 */
export async function capture(page, opts = {}) {
  const args = { join: opts.join ?? 240, wrap: opts.wrap ?? 360 };
  try {
    return await page.evaluate(scan, args);
  } catch (first) {
    // A navigation can destroy the context mid-scan; one retry after the load settles it.
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    return page
      .evaluate(scan, args)
      .catch(() => ({ ...EMPTY, url: page.url(), note: String(first.message).split('\n')[0] }));
  }
}
