// Runs the page scanner and the tools against real Chromium and the fixture site.
// Needs Playwright, so run it inside the Playwright MCP image (see README).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { capture } from '../snapshot.mjs';
import { browser as kit } from '../tools.mjs';
import { data, serve } from './site.mjs';

let chromium = null;
try {
  ({ chromium } = createRequire(process.env.PLAYWRIGHT_ROOT || '/app/')('playwright-core'));
} catch {
  /* not installed here: the suite is skipped */
}

describe('pages', { skip: chromium ? false : 'playwright-core is not available' }, () => {
  let server;
  let chrome;
  let page;
  let base;
  let tools;
  const text = (snap) => snap.lines.map((l) => l.t).join('\n');
  const idOf = (snap, label) => snap.targets.find((t) => t.label === label)?.id;

  before(async () => {
    server = await serve(0);
    base = `http://127.0.0.1:${server.address().port}`;
    // The image ships full Chromium, not the headless shell, so ask for that build.
    chrome = await chromium.launch({
      channel: 'chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    page = await chrome.newPage();
    tools = kit({ current: () => page, open: async () => page, budget: 5000 });
  });

  after(async () => {
    await chrome?.close();
    server?.close();
  });

  const html = async (body) => {
    await page.setContent(
      `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`,
    );
    return capture(page);
  };

  describe('listing without <main>', () => {
    let snap;
    before(async () => {
      await page.goto(`${base}/shop/`);
      snap = await capture(page);
    });

    test('shows every item, not only the first <article>', () => {
      const all = text(snap);
      for (const p of data.products.slice(0, 12)) {
        assert.ok(all.includes(p.title), `missing "${p.title}"`);
        assert.ok(all.includes(`£${p.price}`), `missing price of "${p.title}"`);
      }
    });

    test('uses the full title of an ellipsized link, once', () => {
      const title = 'A Short Atlas of Tidal Islands and the People Who Left Them';
      assert.equal(text(snap).split(title).length - 1, 1);
      assert.ok(!text(snap).includes('A Short Atlas of Tidal Isl ...'));
    });

    test('keeps one item on one line, with its link id, price and stock', () => {
      const line = snap.lines.find((l) => l.t.includes('Starlight for Beginners'));
      assert.match(
        line.t,
        /^9\. \(star rating Five\) · Starlight for Beginners \[\d+\] · £37\.80 · In stock · Add to basket \[\d+ button\]$/,
      );
    });

    test('shows pagination with where it leads', () => {
      assert.match(text(snap), /Page 1 of 3 · next \[\d+: \/shop\/\?page=2\]/);
      assert.equal(snap.targets.filter((t) => t.next).length, 1);
      assert.equal(snap.targets.find((t) => t.next).label, 'next');
    });

    test('shows the category menu, the search box and the sort select', () => {
      const all = text(snap);
      assert.match(
        all,
        /Travel \[\d+\] \(9\) · Science \[\d+\] \(9\) · Cooking \[\d+\] \(9\) · History \[\d+\] \(9\)/,
      );
      assert.match(all, /Search books \[\d+ searchbox\] Search \[\d+ button\]/);
      assert.match(
        all,
        /Sort by \[\d+ select = "Featured"; options: Featured, Title, Price: low to high, Price: high to low\]/,
      );
      assert.ok(!/Sort by Sort by/.test(all), 'the label is not printed twice');
    });

    test('labels each part of the page', () => {
      const kinds = snap.regions.map((r) => r.kind);
      assert.deepEqual(kinds, ['content', 'header', 'nav', 'aside', 'footer']);
      assert.equal(snap.regions[2].label, 'Breadcrumb');
    });

    test('gives the same link the same id, and keeps ids when the page is scanned again', async () => {
      const home = snap.targets.filter((t) => t.href === `${base}/shop/`);
      assert.equal(home.length, 1, 'brand link and breadcrumb share one id');
      const again = await capture(page);
      assert.deepEqual(again.targets, snap.targets);
      await page.evaluate(() =>
        document.body.insertAdjacentHTML(
          'afterbegin',
          '<p><a href="/shop/new">New arrivals</a></p>',
        ),
      );
      const grown = await capture(page);
      for (const t of snap.targets)
        assert.deepEqual(
          grown.targets.find((g) => g.id === t.id),
          t,
        );
      assert.ok(idOf(grown, 'New arrivals') > Math.max(...snap.targets.map((t) => t.id)));
    });
  });

  describe('product page', () => {
    test('turns a label/value table into labelled lines', async () => {
      await page.goto(`${base}/shop/p/how-glaciers-remember/`);
      const all = text(await capture(page));
      assert.match(all, /^Pages: 287$/m);
      assert.match(all, /^Publisher: Gull & Anchor Press$/m);
      assert.match(all, /^Price \(excl\. tax\): £46\.01$/m);
      assert.match(all, /Home \[\d+\] · Cooking \[\d+\] · How Glaciers Remember/);
    });
  });

  describe('long article', () => {
    let snap;
    before(async () => {
      await page.goto(`${base}/wiki/Aldoria`);
      snap = await capture(page);
    });

    test('leaves out hidden content', () => {
      assert.ok(!text(snap).includes('hidden banner'));
    });

    test('keeps headings with their level', () => {
      const heads = snap.lines.filter((l) => l.k === 'h').map((l) => l.t);
      assert.ok(heads.includes('# Aldoria'));
      assert.ok(heads.includes('## Economy'));
      assert.ok(heads.includes('### Largest cities'));
    });

    test('reads the infobox as labelled lines', () => {
      assert.match(text(snap), /^Population \(2024 census\): 3,912,480$/m);
      assert.match(text(snap), /^Capital: Ilvane \[\d+\]$/m);
    });

    test('keeps table rows with their column names', () => {
      const row = snap.lines.find((l) => l.k === 'row' && l.t.includes('Sorrow Bay'));
      assert.match(
        row.t,
        /^Rank: 3 \| City: Sorrow Bay \[\d+\] \| Province: Westmark \| Population: 287,410$/,
      );
      assert.ok(!snap.lines.some((l) => l.t.includes('| Rank | City |')), 'no bare header row');
      assert.deepEqual(row.head, ['Rank', 'City', 'Province', 'Population']);
      assert.equal(row.cells[0], '3');
      assert.equal(row.cells[3], '287,410');
    });

    test('splits long paragraphs so no line is a wall of text', () => {
      const longest = Math.max(...snap.lines.filter((l) => l.k === 'p').map((l) => l.t.length));
      assert.ok(longest <= 360, `longest line is ${longest}`);
    });

    test('marks links that leave the site with their host', () => {
      assert.match(text(snap), /Archived record 1000 \[\d+: archive\.example\.org\]/);
    });

    test('folds a long menu of links into a few lines', () => {
      const langs = snap.lines.filter(
        (l) => snap.regions[l.r].label === 'Languages' && l.k === 'links',
      );
      assert.ok(langs.length >= 2 && langs.length <= 8, `${langs.length} lines for 48 links`);
    });
  });

  describe('news front page', () => {
    test('shows every teaser and reports the consent dialog as its own region', async () => {
      await page.goto(`${base}/news/`);
      const snap = await capture(page);
      for (const [, head] of data.STORIES)
        assert.ok(
          snap.lines.some((l) => l.k === 'h' && l.t.includes(head)),
          head,
        );
      assert.match(text(snap), /By Corin Vale · 14 June 2025/);
      const dialog = snap.regions.findIndex((r) => r.kind === 'dialog');
      assert.equal(snap.regions[dialog].label, 'Cookie consent');
      const lines = snap.lines.filter((l) => l.r === dialog).map((l) => l.t);
      assert.equal(lines[0], 'We use cookies to measure readership.');
      assert.match(lines[1], /^Reject all \[\d+ button\] Accept all \[\d+ button\]$/);
    });
  });

  describe('markup details', () => {
    test("rewrites the page's own bracketed numbers and drops footnote markers", async () => {
      const snap = await html(
        '<p>Water boils at 100 degrees<sup><a href="#cite_note-4">[4]</a></sup> at sea level [12].</p><p id="cite_note-4">Note.</p>',
      );
      assert.equal(snap.lines[0].t, 'Water boils at 100 degrees at sea level (12).');
      assert.equal(snap.targets.length, 0);
    });

    test('numbers repeated blocks that are a list in all but markup', async () => {
      const cards = ['Kettle', 'Toaster', 'Blender']
        .map((n) => `<div class="card"><h4><a href="/${n}">${n}</a></h4><p>£10.00</p></div>`)
        .join('');
      const snap = await html(
        `<div class="results">${cards}</div><p class="note">Plain one.</p><p class="note">Plain two.</p><p class="note">Plain three.</p>`,
      );
      const all = snap.lines.map((l) => l.t);
      assert.match(all[0], /^1\. Kettle \[\d+\] · £10\.00$/);
      assert.match(all[1], /^2\. Toaster \[\d+\] · £10\.00$/);
      assert.match(all[2], /^3\. Blender \[\d+\] · £10\.00$/);
      assert.deepEqual(
        all.slice(3),
        ['Plain one.', 'Plain two.', 'Plain three.'],
        'paragraphs are not numbered',
      );
      const rows = await html(
        '<div class="row"><p>Intro text here.</p></div><div class="row"><p>See <a href="/x">the guide</a>.</p></div><div class="row"><p>More text.</p></div>',
      );
      assert.ok(!rows.lines.some((l) => /^\d+\. /.test(l.t)), 'layout rows are not numbered');
    });

    test('keeps a heading that a site lays out inline', async () => {
      const snap = await html(
        '<div><h2 style="display:inline">History</h2> <span>[<a href="/edit">edit</a>]</span></div><p>Text.</p>',
      );
      assert.deepEqual(snap.lines[0], { n: 1, t: '## History', k: 'h', lv: 2, r: 0 });
    });

    test('reads a definition list as labelled lines', async () => {
      const snap = await html(
        '<dl><dt>Opening hours</dt><dd>9 to 5</dd><dt>Phone</dt><dd>555 0100</dd></dl>',
      );
      assert.deepEqual(
        snap.lines.map((l) => l.t),
        ['Opening hours: 9 to 5', 'Phone: 555 0100'],
      );
    });

    test('reads a layout table as plain lines, one per row', async () => {
      const snap = await html(
        '<div><table><tr><td>1.</td><td><a href="/a">First story</a></td></tr><tr><td>2.</td><td><a href="/b">Second story</a></td></tr></table></div>',
      );
      assert.match(snap.lines[0].t, /^1\. First story \[\d+\]$/);
      assert.equal(snap.lines.length, 2);
    });

    test('folds the short parts of one item into a line, but never sentences or top-level blocks', async () => {
      const card = await html(
        '<div><section><p class="name">Kettle</p><p class="price">£12.00</p><p>In stock</p></section></div>',
      );
      assert.deepEqual(
        card.lines.map((l) => l.t),
        ['Kettle · £12.00 · In stock'],
      );
      const prose = await html(
        '<div><section><p>The kettle boils a litre in two minutes.</p><p>£12.00</p></section></div>',
      );
      assert.equal(prose.lines.length, 2);
      const top = await html('<p>Kettle</p><p>£12.00</p>');
      assert.equal(top.lines.length, 2);
    });

    test('names fields from their label, placeholder or name, and never prints a password', async () => {
      const snap = await html(`<form><label for="u">User name</label><input id="u" value="ada">
        <input type="password" name="pw" value="secret"><label><input type="checkbox" checked> Remember me</label>
        <textarea placeholder="Your message"></textarea><input type="hidden" name="token" value="t0k3n"><button>Send</button></form>`);
      const all = text(snap);
      assert.match(all, /User name \[\d+ textbox = "ada"\]/);
      assert.match(all, /pw \[\d+ password\]/);
      assert.match(all, /Remember me \[\d+ checkbox; checked\]/);
      assert.match(all, /Your message \[\d+ textbox\]/);
      assert.match(all, /Send \[\d+ button\]/);
      assert.ok(!all.includes('secret') && !all.includes('t0k3n'));
    });

    test('treats a clickable element that is not a link or button as a button', async () => {
      const snap = await html(
        '<div style="cursor:pointer" onclick="1">Show details</div><p>Plain text</p>',
      );
      assert.match(snap.lines[0].t, /^Show details \[\d+ button\]$/);
    });

    test('reads an icon by its accessible name and an open shadow tree by its content', async () => {
      const snap = await html(
        '<p>Rating <span role="img" aria-label="4 out of 5 stars"></span></p><div id="host"></div>',
      );
      await page.evaluate(() => {
        document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
          '<p>Inside the component</p>';
      });
      const all = text(await capture(page));
      assert.equal(snap.lines[0].t, 'Rating (4 out of 5 stars)');
      assert.match(all, /Inside the component/);
    });

    test('keeps a link id attached to its label when a paragraph is split', async () => {
      const filler = 'word '.repeat(70);
      const snap = await html(`<p>${filler}<a href="/target">the target page</a> ${filler}</p>`);
      assert.ok(snap.lines.length > 1);
      assert.ok(snap.lines.some((l) => /the target page \[\d+\]/.test(l.t)));
      assert.ok(!snap.lines.some((l) => /^\[\d+\]/.test(l.t)));
    });
  });

  describe('tools', () => {
    test('open_url returns the page, and click follows a link by id', async () => {
      const opened = await tools.call('open_url', { url: `${base}/shop/` });
      assert.equal(opened.failed, false);
      assert.match(opened.text, /Whole page, \d+ lines:/);
      assert.match(opened.text, /\(end of page; next page: "next" \[\d+\]\)$/);
      const id = idOf(tools.latest(), 'Starlight for Beginners');
      const clicked = await tools.call('click', { id });
      assert.match(
        clicked.text,
        new RegExp(
          `^Clicked "Starlight for Beginners" \\[${id}\\]\\.\nStarlight for Beginners \\| Paper Lantern Books\nURL: ${base}/shop/p/starlight-for-beginners/`,
        ),
      );
      assert.match(clicked.text, /Publisher: Gull & Anchor Press/);
    });

    test('go_back returns to the listing, and fails plainly when there is nowhere to go', async () => {
      const back = await tools.call('go_back', {});
      assert.match(back.text, new RegExp(`URL: ${base}/shop/\n`));
      const fresh = await chrome.newPage();
      const lone = kit({ current: () => fresh, open: async () => fresh });
      await lone.call('open_url', { url: `${base}/shop/` });
      const stuck = await lone.call('go_back', {});
      assert.equal(stuck.failed, true);
      assert.match(stuck.text, /no earlier page/);
      assert.equal(fresh.url(), `${base}/shop/`, 'it does not strand the model on a blank page');
      await fresh.close();
    });

    test('type_text fills a field, and with submit runs the search', async () => {
      await tools.call('open_url', { url: `${base}/shop/` });
      const id = idOf(tools.latest(), 'Search books');
      const typed = await tools.call('type_text', { id, text: 'ferry' });
      assert.match(
        typed.text,
        /Typed "ferry" into "Search books" \[\d+ searchbox\]\.\nTo submit it/,
      );
      const sent = await tools.call('type_text', { id, text: 'ferry', submit: true });
      assert.match(sent.text, /and pressed Enter\./);
      assert.match(
        sent.text,
        /The Last Ferry Keeper of Lake Ombra and Her Seven Winters \[\d+\] · £30\.14/,
      );
    });

    test('type_text chooses a select option by its visible name', async () => {
      await tools.call('open_url', { url: `${base}/shop/` });
      const id = idOf(tools.latest(), 'Sort by');
      const sorted = await tools.call('type_text', { id, text: 'price: low to high' });
      assert.match(sorted.text, /^Chose "Price: low to high" in "Sort by" \[\d+ select\]\./);
      assert.match(sorted.text, /1\. \(star rating \w+\) · Forty Mountain Passes \[\d+\] · £8\.13/);
      const wrong = await tools.call('type_text', {
        id: idOf(tools.latest(), 'Sort by'),
        text: 'newest',
      });
      assert.equal(wrong.failed, true);
      assert.match(wrong.text, /has no option "newest"\. Its options are: Featured, Title/);
    });

    test('a click that changes nothing says so', async () => {
      await tools.call('open_url', { url: `${base}/shop/` });
      const id = tools.latest().targets.find((t) => t.label === 'Add to basket').id;
      const result = await tools.call('click', { id });
      assert.match(
        result.text,
        /Nothing on the page changed\. The click had no visible effect\. To open the item on that line, click its link instead: "The Salt Road to Varenne" \[\d+\]\.$/,
      );
    });

    test('a click that changes the page in place reports only the difference', async () => {
      await tools.call('open_url', { url: `${base}/news/` });
      const id = idOf(tools.latest(), 'Reject all');
      const result = await tools.call('click', { id });
      assert.match(result.text, /^Clicked "Reject all" \[\d+ button\]\.\nStill on /);
      assert.match(result.text, /Lines that went away:\n {2}We use cookies/);
      assert.ok(result.text.length < 600, 'the whole page is not repeated');
    });

    test('rejects an id that is not on the page, and a field tool on a button', async () => {
      await tools.call('open_url', { url: `${base}/shop/` });
      const missing = await tools.call('click', { id: 4321 });
      assert.equal(missing.failed, true);
      assert.match(
        missing.text,
        /There is no \[4321\] on the page .*The ids on this page go up to \d+/,
      );
      const text0 = await tools.call('click', { id: 'Travel' });
      assert.match(text0.text, /"Travel" is not an id/);
      const button = tools.latest().targets.find((t) => t.kind === 'button').id;
      const typed = await tools.call('type_text', { id: button, text: 'x' });
      assert.match(
        typed.text,
        /^"Search" \[\d+ button\] is a button, not a field\. Type into a field: "Search books" \[\d+ searchbox\], "Sort by" \[\d+ select\]\.$/,
      );
    });

    test('a long page opens as an outline; read_page and find_in_page reach the rest', async () => {
      const opened = await tools.call('open_url', { url: `${base}/wiki/Aldoria` });
      assert.match(opened.text, /Long page: \d+ lines/);
      assert.match(opened.text, /\d+\| ## Economy/);
      assert.ok(opened.text.length <= 5400, `first view was ${opened.text.length} characters`);
      assert.ok(!opened.text.includes('34 percent'), 'the fact sits deeper than the first view');

      const line = Number(opened.text.match(/(\d+)\| ## Economy/)[1]);
      const section = await tools.call('read_page', { line });
      assert.match(section.text, new RegExp(`Lines ${line}-\\d+ of \\d+:`));
      assert.match(section.text, /34 percent of export earnings/);

      const found = await tools.call('find_in_page', { text: 'third largest city Sorrow Bay' });
      assert.match(
        found.text,
        /Rank: 3 \| City: Sorrow Bay \[\d+\] \| Province: Westmark \| Population: 287,410/,
      );

      const synonym = await tools.call('find_in_page', { text: 'parliament seats' });
      assert.match(synonym.text, /has 180 seats/);
    });

    test('says where to look next when a search finds nothing close', async () => {
      await tools.call('open_url', { url: `${base}/shop/` });
      const title = 'The Clockmakers Rebellion of 1742 and What Came After';
      const found = await tools.call('find_in_page', { text: title });
      assert.match(found.text, /No line has all the words of /);
      assert.match(found.text, /If it is not on this page: next page: "next" \[\d+\]; /);
      assert.match(found.text, /the site has a search field: "Search books" \[\d+ searchbox\]\.$/);
      const exact = await tools.call('find_in_page', { text: 'Starlight for Beginners' });
      assert.match(exact.text, /^.*\n.*\nBest matches for "Starlight for Beginners"/);
      assert.doesNotMatch(exact.text, /If it is not on this page/);
    });

    test('follows a story onto its second page', async () => {
      const front = await tools.call('open_url', { url: `${base}/news/` });
      assert.match(front.text, /\(end of page\)$/, 'teaser links are not a next page');
      const first = await tools.call('click', {
        id: idOf(tools.latest(), 'Harbour bridge to reopen after two-year repair'),
      });
      assert.match(first.text, /Continue reading \[\d+: \/news\/a\/harbour-bridge\?page=2\]/);
      assert.match(first.text, /\(end of page; next page: "Continue reading" \[\d+\]\)$/);
      const second = await tools.call('click', { id: idOf(tools.latest(), 'Continue reading') });
      assert.match(second.text, /18\.4 million marks/);
    });

    test('reports a failed load and an error page', async () => {
      const dead = await tools.call('open_url', { url: 'http://127.0.0.1:9/' });
      assert.equal(dead.failed, true);
      assert.match(dead.text, /Could not open http:\/\/127\.0\.0\.1:9\/: /);
      const missing = await tools.call('open_url', { url: `${base}/shop/nothing-here` });
      assert.equal(missing.failed, false, 'an error page with content is shown, with its status');
      assert.match(missing.text, /^The server answered with error 404 for this address\.\n/);
      assert.match(missing.text, /# Page not found/);
      const next = await tools.call('open_url', { url: `${base}/shop/` });
      assert.equal(next.failed, false, 'the page after a failed load opens normally');
      assert.match(next.text, /# All books/);
      const odd = await tools.call('open_url', { url: 'file:///etc/passwd' });
      assert.equal(odd.failed, true);
      assert.match(odd.text, /Only http and https addresses/);
    });

    test('gives a "#" link run by a script an id, and leaves a same-page jump as text', async () => {
      await page.goto(`${base}/dynamic/`);
      const all = text(await capture(page));
      assert.match(all, /2012 \[\d+ button\] 2011 \[\d+ button\]/);
      assert.match(all, /Jump to films$/m);
    });

    test('shows content that a script fetches after the click', async () => {
      await tools.call('open_url', { url: `${base}/dynamic/` });
      const result = await tools.call('click', { id: idOf(tools.latest(), '2012') });
      assert.match(result.text, /^Clicked "2012" \[\d+ button\]\.\nStill on /);
      assert.match(result.text, /New or changed lines:\n\d+\| Title: Tidewater \| Awards: 4\n/);
    });

    test('shows what a single-page app fetches after its frame has loaded', async () => {
      const opened = await tools.call('open_url', { url: `${base}/store/` });
      for (const [title, price] of data.STOCK) {
        assert.ok(opened.text.includes(`${title} · £${price}`), `missing "${title}"`);
      }
    });

    test('waits for results that a search on the same page fetches', async () => {
      await tools.call('open_url', { url: `${base}/store/` });
      // As on a real site by the time a model acts: Playwright's network idle has fired for
      // this document and does not fire again for the request the search starts.
      await page.waitForLoadState('networkidle');
      const id = tools.latest().targets.find((t) => t.kind === 'searchbox').id;
      const result = await tools.call('type_text', { id, text: 'drill', submit: true });
      assert.match(result.text, /Searched for: drill · 2 found/);
      assert.match(result.text, /Kestrel Impact Drill · £132\.60/);
      const all = text(tools.latest());
      assert.ok(all.includes('Ridgeback Cordless Drill · £89.40'));
      assert.ok(!all.includes('Hollin Claw Hammer'), 'the list was replaced');
    });

    test('stops waiting for a request that never ends', async () => {
      const quick = kit({ current: () => page, open: async () => page, wait: 2000 });
      const started = Date.now();
      const opened = await quick.call('open_url', { url: `${base}/store/?live=1` });
      const took = Date.now() - started;
      assert.ok(took < 3500, `open_url took ${took} ms`);
      assert.match(opened.text, /Kestrel Impact Drill · £132\.60/, 'the answered request counted');
    });

    test('follows a link that would open a new tab in the same tab', async () => {
      await page.goto(`${base}/`);
      await page.evaluate(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<p><a href="/docs/install" target="_blank">Docs in a new tab</a></p>',
        );
      });
      const before = chrome.contexts()[0].pages().length;
      const id = (await capture(page)).targets.find((t) => t.label === 'Docs in a new tab').id;
      const result = await tools.call('click', { id });
      assert.match(result.text, /URL: .*\/docs\/install\n/);
      assert.equal(chrome.contexts()[0].pages().length, before, 'no extra tab was opened');
    });

    test('shows a frame as something to open, and opens the document inside it', async () => {
      await page.goto(`${base}/`);
      await page.evaluate(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<iframe src="/news/" title="Latest news" width="600" height="300"></iframe><iframe src="/docs/" width="1" height="1"></iframe>',
        );
      });
      const snap = await capture(page);
      assert.match(
        snap.lines.map((l) => l.t).join('\n'),
        /^Latest news \(open it to read what it shows\) \[\d+ frame: \/news\/\]$/m,
      );
      assert.equal(
        snap.targets.filter((t) => t.kind === 'frame').length,
        1,
        'the 1x1 frame is left out',
      );
      const result = await tools.call('click', {
        id: snap.targets.find((t) => t.kind === 'frame').id,
      });
      assert.match(
        result.text,
        /^Clicked "Latest news \(open it to read what it shows\)" \[\d+ frame\]\.\nFront page - The Calder Courier\n/,
      );
    });

    test('refuses an id chosen before the page changed in the same turn', async () => {
      await tools.call('open_url', { url: `${base}/shop/` }, { turn: 1 });
      const guess = await tools.call('click', { id: 5 }, { turn: 1 });
      assert.equal(guess.failed, true);
      assert.match(guess.text, /the page changed earlier in this turn/);
      assert.match(tools.latest().url, /\/shop\/$/, 'the click was not carried out');
      const search = await tools.call('find_in_page', { text: 'travel' }, { turn: 1 });
      assert.equal(search.failed, false, 'reading is still allowed');
      const next = await tools.call('click', { id: idOf(tools.latest(), 'Travel') }, { turn: 2 });
      assert.match(next.text, /URL: .*\/shop\/c\/travel\//);
    });

    test('says that no page is open before the first open_url', async () => {
      await page.goto('about:blank');
      for (const [name, args] of [
        ['find_in_page', { text: 'x' }],
        ['read_page', { line: 1 }],
        ['click', { id: 1 }],
      ]) {
        const result = await tools.call(name, args);
        assert.equal(result.failed, true);
        assert.match(result.text, /No page is open yet\. Call open_url/);
      }
    });

    test('tells a model that repeats itself to try something else', async () => {
      await tools.call('open_url', { url: `${base}/shop/` });
      await tools.call('find_in_page', { text: 'zebra' });
      await tools.call('find_in_page', { text: 'zebra' });
      const third = await tools.call('find_in_page', { text: 'zebra' });
      assert.match(third.text, /made this exact call 3 times/);
      const other = await tools.call('find_in_page', { text: 'travel' });
      assert.doesNotMatch(other.text, /exact call/);
    });
  });
});
