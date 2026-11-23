import { splitToolCallName } from 'librechat-data-provider';
import type { TAttachment, TAttachmentMetadata, TFile } from 'librechat-data-provider';
import { boundIntentLabel, getToolCallIntent } from '../../../react/parts/intent';
import { isImageAttachment } from '../attachmentTypes';

/** A tool call as the transcript holds it: what it was asked and what it answered. */
export type BrowseCall = {
  name: string;
  args?: string | Record<string, unknown>;
  output?: string | null;
};

/** The page a step left the browser on. */
export type BrowsePage = { url: string; title?: string };

/** A screenshot and the call that produced it, before the host resolves where the image loads from. */
export type ShotSource = { file: TAttachment; call: BrowseCall; src: string };

/** One picture in a browser frame: the image, the step that took it and the page it shows. */
export type Shot = {
  /** Identity of the picture: keys it, and lets the frame stay on it while later ones arrive. */
  id: string;
  src: string;
  width?: number;
  height?: number;
  /** Name to save the image under. */
  filename: string;
  /** The tool that took the step, as its row names it. */
  tool: string;
  /** What the step did, in one line. */
  note?: string;
  page?: BrowsePage;
};

/** The line a page result opens its address with, after the line holding the page title. */
const ADDRESS = /^URL: (\S+)[ \t]*$/m;
/** The line an action result names its page with when the action stayed on it. */
const STAYED = /^Still on (\S+)[ \t]*$/m;

function webAddress(text: string): string | undefined {
  try {
    const { protocol, href } = new URL(text);
    return protocol === 'http:' || protocol === 'https:' ? href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A picture a tool addressed to the user alone: a view of the step it just took, which the
 * model never saw. A run of them is shown as one frame to step through, where a stack of
 * full-size images would bury the conversation. An image a tool returned as its result, for the
 * model as much as for the user, keeps the presentation every other attachment has.
 */
export function isShot(file: TAttachment): boolean {
  const { audience } = file as TFile & TAttachmentMetadata;
  if (audience == null || audience.length === 0 || audience.includes('assistant')) {
    return false;
  }
  return isImageAttachment(file);
}

/**
 * The page a tool result says the browser is on: an address on a line of its own (`URL: …`),
 * with the page title on the line above, or the address an action reports staying on. Only web
 * addresses count, since the frame offers the address as a link.
 */
export function readPage(output?: string | null): BrowsePage | undefined {
  if (!output) {
    return undefined;
  }
  const address = ADDRESS.exec(output);
  if (address == null) {
    const stayed = STAYED.exec(output);
    const url = stayed == null ? undefined : webAddress(stayed[1]);
    return url == null ? undefined : { url };
  }
  const url = webAddress(address[1]);
  if (url == null) {
    return undefined;
  }
  const above = output.slice(0, address.index).trimEnd();
  const title = above.slice(above.lastIndexOf('\n') + 1).trim();
  return title ? { url, title } : { url };
}

/**
 * The sentence a result opens with about the step itself (`Clicked "next" [34].`, or what went
 * wrong). A result that opens with the page instead has no such sentence: its first line is the
 * page title, which the frame already shows.
 */
export function readOutcome(output?: string | null): string | undefined {
  if (!output) {
    return undefined;
  }
  const end = output.indexOf('\n');
  const first = end < 0 ? output : output.slice(0, end);
  if (first.startsWith('URL: ') || (end >= 0 && output.startsWith('URL: ', end + 1))) {
    return undefined;
  }
  return boundIntentLabel(first);
}

/** The argument that says most about a call in one value: its first text, else its first number. */
export function readSubject(args?: string | Record<string, unknown>): string | undefined {
  let values: unknown[] = [];
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args);
      values = parsed != null && typeof parsed === 'object' ? Object.values(parsed) : [];
    } catch {
      return undefined;
    }
  } else if (args != null) {
    values = Object.values(args);
  }
  const text = values.find((value): value is string => typeof value === 'string' && value !== '');
  if (text != null) {
    return boundIntentLabel(text);
  }
  const number = values.find((value): value is number => typeof value === 'number');
  return number == null ? undefined : String(number);
}

/**
 * What a step did, in one line: the label the model wrote for the call when it wrote one, else
 * the sentence its result opens with, else the argument it was called with.
 */
export function describeStep(call: BrowseCall): string | undefined {
  return getToolCallIntent(call.args) ?? readOutcome(call.output) ?? readSubject(call.args);
}

/**
 * The frame's pictures, in step order. A step whose result names no page (a click that changed
 * nothing, a failed action) is still on the page of the step before it.
 */
export function toShots(sources: readonly ShotSource[], servers: readonly string[]): Shot[] {
  let page: BrowsePage | undefined;
  return sources.map(({ file, call, src }, index) => {
    const { file_id, filename, width, height } = file as TFile & TAttachmentMetadata;
    page = readPage(call.output) ?? page;
    const [tool] = splitToolCallName(call.name, servers);
    return {
      id: file_id ?? `${index}:${src}`,
      src,
      width,
      height,
      filename: filename ?? '',
      tool: tool || call.name,
      note: describeStep(call),
      page,
    };
  });
}

/** The address as a browser shows it: host and path, without the scheme or a lone slash. */
export function shortAddress(url: string): string {
  try {
    const { host, pathname, search } = new URL(url);
    return `${host}${pathname === '/' ? '' : pathname}${search}`;
  } catch {
    return url;
  }
}

/** What a screenshot shows, in a few words: the page's title, else its address, else the step. */
export function shotName(shot: Shot): string {
  if (shot.page == null) {
    return shot.tool;
  }
  return shot.page.title || shortAddress(shot.page.url);
}
