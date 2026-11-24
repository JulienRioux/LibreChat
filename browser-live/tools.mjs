// The browser tools a small model works with: six calls that each answer with the page as
// text, so the model never has to ask "what happened?" after acting.
import { UNCHANGED, changes, overview, slice } from './view.mjs';
import { capture, locate } from './snapshot.mjs';
import { find } from './find.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('./snapshot.mjs').Snapshot} Snapshot */

export const TOOLS = [
  {
    name: 'open_url',
    description:
      'Open a web address and read the page. The page comes back as numbered lines. Every link, button and field has its id in brackets right after its name: "Travel [3]", "Search [7 button]", "Search books [2 searchbox]". A long page comes back as an outline plus its first lines.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Address to open, e.g. "https://example.com/page".' },
      },
      required: ['url'],
    },
  },
  {
    name: 'click',
    description:
      'Follow a link or press a button on the open page, by the id in brackets after its name. Use it to open an item, to go to the next page of a list, or to press a button. Returns the page you land on, or what changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The number in brackets, e.g. 3 for "Travel [3]".' },
      },
      required: ['id'],
    },
  },
  {
    name: 'type_text',
    description:
      'Type into a field of the open page (a textbox or searchbox), or choose an option of a select, by the id in brackets after the field name. Set submit to true to press Enter afterwards, for example to run a search.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description:
            'The number in brackets after the field name, e.g. 2 for "Search books [2 searchbox]".',
        },
        text: { type: 'string', description: 'Text to type, or the option to choose.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.' },
      },
      required: ['id', 'text'],
    },
  },
  {
    name: 'find_in_page',
    description:
      'Search the whole open page for words. Returns the matching lines with their line numbers and the heading they are under. Use it to locate a fact, a link or a section on a long page; if nothing matches, try other words.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Words to look for, e.g. "opening hours".' },
      },
      required: ['text'],
    },
  },
  {
    name: 'read_page',
    description:
      'Read the open page from a line number: to continue below what was shown, or to jump to a heading listed in the outline.',
    inputSchema: {
      type: 'object',
      properties: { line: { type: 'number', description: 'Line number to start reading from.' } },
      required: ['line'],
    },
  },
  {
    name: 'go_back',
    description: 'Return to the previous page.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TYPED = new Set(['textbox', 'searchbox', 'password', 'select', 'slider']);
/** Tools that act on an id from the page the model last saw. */
const BY_ID = new Set(['click', 'type_text']);
const NONE = 'No page is open yet. Call open_url with the address you want first.';

/**
 * A link or control the way the page shows it: its name, then its id in brackets.
 * @param {import('./snapshot.mjs').Target} t
 */
const name = (t) => `"${t.label}" [${t.id}${t.kind === 'link' ? '' : ` ${t.kind}`}]`;

/** A short, plain cause for a browser error. */
function reason(error) {
  const text = String(error?.message ?? error).split('\n')[0];
  if (/ERR_NAME_NOT_RESOLVED/.test(text)) return 'the site name could not be found';
  if (/ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET/.test(text))
    return 'the site could not be reached';
  if (/ERR_CERT|ERR_SSL/.test(text)) return 'the site has a certificate problem';
  if (/ERR_UNSAFE_PORT/.test(text)) return 'the browser does not open that port';
  if (/ERR_ABORTED/.test(text))
    return 'the load was aborted, which usually means the address is a download and not a page';
  if (/intercepts pointer events/.test(text)) return 'something else on the page is covering it';
  if (/Timeout/i.test(text)) return 'it took too long';
  if (/not attached|detached/.test(text)) return 'it is no longer on the page';
  return text.replace(/^(page|locator|elementHandle)\.\w+: /, '');
}

/** Kinds of request a page's scripts load content with. */
const CONTENT = new Set(['fetch', 'xhr', 'script']);
/** @type {WeakMap<Page, Map<import('playwright-core').Request, number>>} */
const pending = new WeakMap();

/**
 * Starts noting the content requests a page makes, and when each one started, for settle() to
 * wait on. A page already watched is left as it is.
 * @param {Page} page
 */
export function watch(page) {
  if (pending.has(page)) return;
  const open = new Map();
  pending.set(page, open);
  const done = (request) => open.delete(request);
  page.on('request', (request) => {
    if (CONTENT.has(request.resourceType())) open.set(request, Date.now());
  });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
}

/**
 * Waits for a page to stop loading: the document is parsed, the content requests it started
 * since `since` have been answered, and its text has stopped growing. A pause in the text alone
 * is not the end: a single-page app draws its frame first and fills it from its API a moment
 * later, and Playwright's network idle fires only once per document, so it misses a search that
 * runs on the same page. Gives up after `wait` milliseconds, so a request that never ends cannot
 * hold the tool.
 * @param {Page} page
 * @param {{ since?: number, wait?: number }} [opts]   `since` is a `Date.now()` time
 */
export async function settle(page, { since = 0, wait = 5000 } = {}) {
  watch(page);
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  const open = pending.get(page);
  const end = Date.now() + wait;
  let last = -1;
  // Looks taken while nothing was in flight; ten of them is as long as text may keep changing.
  let calm = 0;
  while (calm < 10 && Date.now() < end) {
    const busy = [...open.values()].some((start) => start >= since);
    const size = await page.evaluate(() => document.body?.textContent?.length ?? 0).catch(() => -1);
    if (!busy) {
      if (size === last && (size > 0 || calm >= 2)) return;
      calm++;
    }
    // The text counts as steady only across two looks with nothing in flight.
    last = busy ? -1 : size;
    await page.waitForTimeout(250);
  }
}

/**
 * @param {object} deps
 * @param {() => Page | null} deps.current   the page the model is working on
 * @param {() => Promise<Page>} deps.open   makes a page when none is open
 * @param {number} [deps.budget]   characters of page text per result
 * @param {number} [deps.wait]   milliseconds a step waits at most for the page to finish loading
 */
export function browser({ current, open, budget = 5000, wait = 5000 }) {
  /** @type {Snapshot | null} */
  let shown = null;
  let echo = { key: '', text: '', count: 0 };
  /** The calls a model issued together, and whether one of them has already changed the page. */
  let turn = { id: undefined, moved: false };

  const opened = () => {
    const page = current();
    if (!page || page.url() === 'about:blank') return null;
    watch(page);
    return page;
  };

  const ok = (...parts) => ({ text: parts.filter(Boolean).join('\n'), failed: false });
  const fail = (text) => ({ text, failed: true });

  /** @param {Page} page */
  const look = async (page) => {
    shown = await capture(page);
    return shown;
  };

  /**
   * After an action: follow a tab it may have opened, and wait for the page to settle.
   * @param {Page} page
   * @param {number} since   when the action started
   */
  const arrive = async (page, since) => {
    await page.waitForTimeout(250).catch(() => {});
    const now = current() ?? page;
    await settle(now, { since, wait });
    return now;
  };

  /**
   * Looks at the page after an action. Content that a script fetches arrives after the click
   * returns, so a page that seems untouched gets a moment to finish its requests.
   * @param {Page} page
   * @param {Snapshot} before
   */
  const react = async (page, before) => {
    const after = await look(page);
    const same = after.doc === before.doc && after.url === before.url;
    if (!same || changes(before, after) !== UNCHANGED) return after;
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
    return look(page);
  };

  /**
   * The page after an action: all of it when the action led somewhere, else only the difference.
   * @param {Snapshot} before
   * @param {Snapshot} after
   */
  const result = (before, after, idle) => {
    if (after.doc !== before.doc || after.url !== before.url) return overview(after, { budget });
    const diff = changes(before, after);
    if (diff == null) return overview(after, { budget });
    if (diff === UNCHANGED) return `${diff} ${idle}`;
    return `Still on ${after.url}\n${diff}`;
  };

  /**
   * @param {Page} page
   * @param {unknown} id
   */
  const target = async (page, id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) {
      return {
        error: fail(
          `"${id}" is not an id. Give the number shown in brackets, for example 3 for "Travel [3]".`,
        ),
      };
    }
    const before = await capture(page);
    const known = before.targets.find((t) => t.id === n);
    if (!known) {
      const max = before.targets.reduce((m, t) => Math.max(m, t.id), 0);
      const tip =
        max > 0 ? `The ids on this page go up to ${max}` : 'This page has no links or buttons';
      return {
        error: fail(
          `There is no [${n}] on the page ${before.url}. ${tip}. Use find_in_page to locate the link or button you want.`,
        ),
      };
    }
    const el = (await page.evaluateHandle(locate, n)).asElement();
    if (!el)
      return {
        error: fail(
          `${name(known)} is no longer on the page. Read the page again to get current ids.`,
        ),
      };
    return { before, known, el, n };
  };

  const actions = {
    async open_url({ url }) {
      let address = String(url ?? '').trim();
      if (!address) return fail('Give the address to open, for example "https://example.com".');
      if (!/^[a-z][a-z0-9+.-]*:/i.test(address)) address = `https://${address}`;
      if (!/^(https?:\/\/|about:blank$)/i.test(address))
        return fail(`Only http and https addresses can be opened, not "${address}".`);
      const page = current() ?? (await open());
      watch(page);
      const since = Date.now();
      // The status is read from the response itself, so the model learns it even when the
      // navigation is then aborted.
      let status = 0;
      const seen = (res) => {
        if (res.request().isNavigationRequest() && res.frame() === page.mainFrame())
          status = res.status();
      };
      page.on('response', seen);
      const go = () => page.goto(address, { waitUntil: 'domcontentloaded', timeout: 30000 });
      let response;
      try {
        response = await go().catch(async (e) => {
          // The browser's error page for the previous address can still be loading and cut this
          // navigation short; once it has settled, the address opens normally.
          if (!/interrupted by another navigation/.test(String(e?.message))) throw e;
          await settle(page, { since, wait });
          return go();
        });
      } catch (e) {
        await settle(page, { since, wait });
        if (status >= 400)
          return fail(
            `The server answered with error ${status} for ${address}: the page does not exist or cannot be shown. Check the address, or go back and follow a link instead.`,
          );
        return fail(
          `Could not open ${address}: ${reason(e)}. Check the address, or search the web for the right one.`,
        );
      } finally {
        page.off('response', seen);
      }
      await settle(page, { since, wait });
      const snap = await look(page);
      status = response?.status() ?? status;
      // The browser's own error page stands in for an error answer that had no page of its own.
      if (status >= 400 && (page.url().startsWith('chrome-error:') || snap.lines.length === 0)) {
        return fail(
          `The server answered with error ${status} for ${address}: the page does not exist or cannot be shown. Check the address, or go back and follow a link instead.`,
        );
      }
      const type = response?.headers()['content-type'] ?? '';
      const notes = [];
      if (status >= 400) notes.push(`The server answered with error ${status} for this address.`);
      if (type && !/html|xml|text\/plain/i.test(type))
        notes.push(`This address is a ${type.split(';')[0]} file, not a web page.`);
      return ok(...notes, overview(snap, { budget }));
    },

    async click({ id }) {
      const page = opened();
      if (!page) return fail(NONE);
      const found = await target(page, id);
      if (found.error) return found.error;
      const { before, known, el, n } = found;
      const since = Date.now();
      try {
        // A link made to open a new tab, and the document inside a frame, are opened in this
        // tab: the model works on one page.
        const elsewhere =
          known.href &&
          (known.kind === 'frame' ||
            (await el.evaluate((a) => a.target === '_blank').catch(() => false)));
        if (elsewhere) throw new Error('opens elsewhere');
        await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await el.click({ timeout: 5000 });
      } catch (e) {
        // A plain link that cannot be clicked (covered by a banner, off screen) can still be followed.
        if (!known.href)
          return fail(
            `Could not click ${name(known)}: ${reason(e)}. If a dialog or banner is open, close it first.`,
          );
        try {
          await page.goto(known.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (again) {
          return fail(`Could not follow ${name(known)}: ${reason(again)}.`);
        }
      }
      const now = await arrive(page, since);
      const after = await react(now, before);
      // A button that did nothing was often meant to be the link beside it: name those links.
      const line = before.lines.find((l) => new RegExp(`\\[${n}[ \\]:]`).test(l.t));
      const beside = [...(line?.t.matchAll(/\[(\d+)[\]:]/g) ?? [])]
        .map((m) => before.targets.find((t) => t.id === Number(m[1]) && t.kind === 'link'))
        .filter(Boolean);
      const idle =
        known.kind !== 'link' && beside.length > 0
          ? `The click had no visible effect. To open the item on that line, click its link instead: ${beside.map(name).join(', ')}.`
          : 'The click had no visible effect; this control may need something else first, or does nothing here.';
      return ok(`Clicked ${name(known)}.`, result(before, after, idle));
    },

    async type_text({ id, text, submit }) {
      const page = opened();
      if (!page) return fail(NONE);
      const found = await target(page, id);
      if (found.error) return found.error;
      const { before, known, el, n } = found;
      if (!TYPED.has(known.kind)) {
        const fields = before.targets.filter((t) => TYPED.has(t.kind)).slice(0, 6);
        return fail(
          `${name(known)} is a ${known.kind}, not a field. ${
            fields.length > 0
              ? `Type into a field: ${fields.map(name).join(', ')}.`
              : 'This page has no fields to type into.'
          }`,
        );
      }
      const value = String(text ?? '');
      const since = Date.now();
      let done;
      try {
        if (known.kind === 'select') {
          const options = await el.evaluate((s) =>
            [...s.options].map((o) => ({ label: (o.textContent || '').trim(), value: o.value })),
          );
          const want = value.trim().toLowerCase();
          const pick =
            options.find((o) => o.label.toLowerCase() === want) ??
            options.find((o) => o.value.toLowerCase() === want) ??
            options.find((o) => want && o.label.toLowerCase().includes(want));
          if (!pick)
            return fail(
              `${name(known)} has no option "${value}". Its options are: ${options.map((o) => o.label).join(', ')}.`,
            );
          await el.selectOption(pick.value, { timeout: 5000 });
          done = `Chose "${pick.label}" in ${name(known)}.`;
        } else {
          await el.fill(value, { timeout: 5000 });
          done = `Typed ${known.kind === 'password' ? 'the text' : `"${value}"`} into ${name(known)}`;
          if (submit === true) await el.press('Enter', { timeout: 5000 });
          done += submit === true ? ' and pressed Enter.' : '.';
        }
      } catch (e) {
        return fail(`Could not type into ${name(known)}: ${reason(e)}.`);
      }
      const now = await arrive(page, since);
      const after = await react(now, before);
      const moved = after.doc !== before.doc || after.url !== before.url;
      if (!moved && submit !== true && known.kind !== 'select') {
        return ok(
          done,
          'To submit it, call type_text again with submit set to true, or click the button next to the field.',
        );
      }
      return ok(done, result(before, after, 'Submitting had no visible effect.'));
    },

    async find_in_page({ text }) {
      const page = opened();
      if (!page) return fail(NONE);
      return ok(find(await look(page), String(text ?? ''), { budget }));
    },

    async read_page({ line }) {
      const page = opened();
      if (!page) return fail(NONE);
      const n = Number(line);
      return ok(slice(await look(page), Number.isFinite(n) ? n : 1, { budget }));
    },

    async go_back() {
      const page = opened();
      if (!page) return fail(NONE);
      const from = page.url();
      const since = Date.now();
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      await settle(page, { since, wait });
      if (page.url() === 'about:blank') {
        // The blank page the browser started on is not somewhere to return to.
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
        await settle(page, { since, wait });
      }
      if (page.url() === from) return fail('There is no earlier page to go back to.');
      return ok(overview(await look(page), { budget }));
    },
  };

  return {
    tools: TOOLS,
    has: (name) => Object.hasOwn(actions, name),
    /** The snapshot the model saw last. */
    latest: () => shown,
    /**
     * @param {string} name
     * @param {Record<string, unknown>} [args]
     * @param {{ turn?: unknown }} [opts]   `turn` is the same for calls the model issued together
     */
    async call(name, args = {}, opts = {}) {
      if (opts.turn !== turn.id) turn = { id: opts.turn, moved: false };
      // An id chosen before the page changed is a guess: the model has not seen the new page.
      if (opts.turn !== undefined && turn.moved && BY_ID.has(name)) {
        return fail(
          `Not done: the page changed earlier in this turn, so the id ${args?.id ?? ''} was chosen before you saw the new page. Look at the page shown in the previous result, then call ${name} with an id from it.`,
        );
      }
      const was = shown;
      let outcome;
      try {
        outcome = await actions[name](args ?? {});
      } catch (e) {
        outcome = fail(`${name} failed: ${reason(e)}.`);
      }
      if (shown && shown !== was && (shown.doc !== was?.doc || shown.url !== was?.url))
        turn.moved = true;
      // A model that repeats a call and gets the same answer is stuck; say so once it is clear.
      const key = `${name} ${JSON.stringify(args ?? {})}`;
      echo =
        key === echo.key && outcome.text === echo.text
          ? { ...echo, count: echo.count + 1 }
          : { key, text: outcome.text, count: 1 };
      if (echo.count >= 3) {
        outcome = {
          ...outcome,
          text: `${outcome.text}\nYou have made this exact call ${echo.count} times and the result is the same. Do something different: search with other words, read another part of the page, or open another page.`,
        };
      }
      return outcome;
    },
  };
}
