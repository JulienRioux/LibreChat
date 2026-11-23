import type { TAttachment } from 'librechat-data-provider';
import type { ShotSource } from '../steps';
import {
  isShot,
  toShots,
  readPage,
  shotName,
  readOutcome,
  readSubject,
  describeStep,
  shortAddress,
} from '../steps';

const image = (extra: Record<string, unknown> = {}): TAttachment =>
  ({
    file_id: 'file-1',
    filename: 'file-1-open_url_mcp_browser_img_a1.jpeg',
    filepath: '/images/user/file-1.jpeg',
    width: 1280,
    height: 600,
    messageId: 'message-1',
    toolCallId: 'call-1',
    conversationId: 'conversation-1',
    ...extra,
  }) as TAttachment;

/** What the browser tools answer with: the page as text, opened by its title and address. */
const PAGE = [
  'All books | Paper Lantern Books',
  'URL: http://localhost:8080/shop/',
  'Whole page, 21 lines:',
  '1| Paper Lantern Books [1] · Search books [2 searchbox]',
].join('\n');

describe('isShot', () => {
  it('takes an image its tool addressed to the user alone', () => {
    expect(isShot(image({ audience: ['user'] }))).toBe(true);
  });

  it('leaves an image the model was given where every other attachment goes', () => {
    expect(isShot(image())).toBe(false);
    expect(isShot(image({ audience: [] }))).toBe(false);
    expect(isShot(image({ audience: ['user', 'assistant'] }))).toBe(false);
  });

  it('leaves a file that cannot be drawn as an image, whoever it is for', () => {
    expect(isShot(image({ audience: ['user'], width: undefined }))).toBe(false);
    expect(isShot(image({ audience: ['user'], filename: 'notes.txt' }))).toBe(false);
  });
});

describe('readPage', () => {
  it('reads the address line and the title on the line above it', () => {
    expect(readPage(PAGE)).toEqual({
      url: 'http://localhost:8080/shop/',
      title: 'All books | Paper Lantern Books',
    });
  });

  it('finds the page below the sentence an action opens with', () => {
    expect(readPage(`Clicked "Travel" [5].\n${PAGE}`)).toEqual({
      url: 'http://localhost:8080/shop/',
      title: 'All books | Paper Lantern Books',
    });
  });

  it('reads the page an action stayed on, which comes without a title', () => {
    const output = 'Clicked "Load more" [9].\nStill on https://example.com/list\nNew lines:\n4| x';
    expect(readPage(output)).toEqual({ url: 'https://example.com/list' });
  });

  it('ignores an address that is not a web page, since the frame links to it', () => {
    expect(readPage('Oops\nURL: chrome-error://chromewebdata/')).toBeUndefined();
    expect(readPage('Oops\nURL: javascript:alert(1)')).toBeUndefined();
  });

  it('ignores an address quoted inside a line of the page', () => {
    expect(readPage('12| see URL: https://example.com/elsewhere for more')).toBeUndefined();
  });

  it('has nothing to read in a result that names no page', () => {
    expect(readPage('Clicked "Next" [3]. Nothing on the page changed.')).toBeUndefined();
    expect(readPage('')).toBeUndefined();
    expect(readPage(null)).toBeUndefined();
  });
});

describe('readOutcome', () => {
  it('reads the sentence an action result opens with', () => {
    expect(readOutcome(`Clicked "Travel" [5].\n${PAGE}`)).toBe('Clicked "Travel" [5].');
    expect(readOutcome('There is no [99] on the page.')).toBe('There is no [99] on the page.');
  });

  it('reads nothing from a result that opens with the page itself', () => {
    expect(readOutcome(PAGE)).toBeUndefined();
    expect(readOutcome('URL: https://example.com/')).toBeUndefined();
    expect(readOutcome('')).toBeUndefined();
    expect(readOutcome(undefined)).toBeUndefined();
  });

  it('keeps a very long first line to one bounded label', () => {
    const outcome = readOutcome(`${'word '.repeat(200)}\nrest`);
    expect(outcome?.length).toBe(256);
    expect(outcome?.endsWith('…')).toBe(true);
  });
});

describe('readSubject', () => {
  it('prefers the first text argument, whatever comes before it', () => {
    expect(readSubject({ id: 2, text: 'harbour bridge', submit: true })).toBe('harbour bridge');
    expect(readSubject('{"url":"https://example.com/shop/"}')).toBe('https://example.com/shop/');
  });

  it('falls back to the first number', () => {
    expect(readSubject({ id: 34 })).toBe('34');
    expect(readSubject('{"line":120}')).toBe('120');
  });

  it('has nothing to say for a call without arguments, or with arguments still streaming', () => {
    expect(readSubject({})).toBeUndefined();
    expect(readSubject('{}')).toBeUndefined();
    expect(readSubject('{"url":"https://exa')).toBeUndefined();
    expect(readSubject(undefined)).toBeUndefined();
  });
});

describe('describeStep', () => {
  it('uses the label the model wrote for the call when it wrote one', () => {
    const call = {
      name: 'click_mcp_browser',
      args: '{"intent":"Opening the travel shelf","id":5}',
      output: `Clicked "Travel" [5].\n${PAGE}`,
    };
    expect(describeStep(call)).toBe('Opening the travel shelf');
  });

  it('uses what the result says the step did', () => {
    const call = { name: 'click_mcp_browser', args: '{"id":5}', output: `Clicked "T" [5].\nx` };
    expect(describeStep(call)).toBe('Clicked "T" [5].');
  });

  it('uses what the call was asked when its result opens with the page', () => {
    const call = { name: 'find_in_page_mcp_browser', args: '{"text":"hours"}', output: PAGE };
    expect(describeStep(call)).toBe('hours');
  });

  it('describes a call that is still running by what it was asked', () => {
    expect(describeStep({ name: 'open_url_mcp_browser', args: { url: 'https://a.test/' } })).toBe(
      'https://a.test/',
    );
  });
});

describe('toShots', () => {
  const source = (id: string, name: string, args: string, output: string): ShotSource => ({
    file: image({ file_id: id, filename: `${id}.jpeg`, audience: ['user'] }),
    call: { name, args, output },
    src: `/images/${id}.jpeg`,
  });

  it('names each picture by its tool, without the server the tool belongs to', () => {
    const shots = toShots(
      [source('a', 'open_url_mcp_browser', '{"url":"http://localhost:8080/shop/"}', PAGE)],
      ['browser'],
    );
    expect(shots).toEqual([
      {
        id: 'a',
        src: '/images/a.jpeg',
        width: 1280,
        height: 600,
        filename: 'a.jpeg',
        tool: 'open_url',
        note: 'http://localhost:8080/shop/',
        page: { url: 'http://localhost:8080/shop/', title: 'All books | Paper Lantern Books' },
      },
    ]);
  });

  it('keeps a step that names no page on the page of the step before it', () => {
    const shots = toShots(
      [
        source('a', 'open_url_mcp_browser', '{"url":"http://localhost:8080/shop/"}', PAGE),
        source('b', 'click_mcp_browser', '{"id":9}', 'Clicked "More" [9]. Nothing changed.'),
        source(
          'c',
          'click_mcp_browser',
          '{"id":5}',
          'Clicked "T" [5].\nTravel\nURL: http://x.test/t',
        ),
      ],
      ['browser'],
    );
    expect(shots.map((shot) => shot.page?.url)).toEqual([
      'http://localhost:8080/shop/',
      'http://localhost:8080/shop/',
      'http://x.test/t',
    ]);
    expect(shots.map((shot) => shot.note)).toEqual([
      'http://localhost:8080/shop/',
      'Clicked "More" [9]. Nothing changed.',
      'Clicked "T" [5].',
    ]);
  });

  it('leaves the page unknown until a step names one', () => {
    const [shot] = toShots(
      [source('a', 'click_mcp_browser', '{"id":9}', 'Could not click "More" [9].')],
      [],
    );
    expect(shot.page).toBeUndefined();
    expect(shotName(shot)).toBe('click');
  });
});

describe('shortAddress and shotName', () => {
  it('shows an address the way a browser does', () => {
    expect(shortAddress('https://example.com/')).toBe('example.com');
    expect(shortAddress('http://localhost:8080/shop/?page=2')).toBe('localhost:8080/shop/?page=2');
    expect(shortAddress('not an address')).toBe('not an address');
  });

  it('names a picture by its page title, then its address', () => {
    const base = { id: 'a', src: '/a.jpeg', filename: 'a.jpeg', tool: 'open_url' };
    expect(shotName({ ...base, page: { url: 'https://example.com/a', title: 'Shop' } })).toBe(
      'Shop',
    );
    expect(shotName({ ...base, page: { url: 'https://example.com/a' } })).toBe('example.com/a');
  });
});
