import { memo, useCallback, useRef, useState } from 'react';
import { IconButton, useLocalize } from '@librechat/client';
import { ChevronLeft, ChevronRight, Globe, Maximize2 } from 'lucide-react';
import type { MemoExoticComponent, MouseEvent, ReactElement } from 'react';
import type { Shot } from './steps';
import { shortAddress, shotName } from './steps';
import BrowseViewer from './Viewer';

export type BrowseFrameProps = {
  /** The screenshots of one run of steps, oldest first. */
  shots: readonly Shot[];
  onDownload: (shot: Shot) => void;
};

/**
 * A run of browser steps as one frame in the conversation: the page each step left the browser
 * on, one screenshot at a time. It shows the newest step, and keeps to it as more arrive, until
 * the reader steps back to an earlier one. The screenshot opens in a viewer to zoom and move
 * around in.
 */
function BrowseFrameBody({ shots, onDownload }: BrowseFrameProps): ReactElement | null {
  const localize = useLocalize();
  /** Whichever control opened the viewer: it takes focus back when the viewer closes. */
  const opener = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  /** The viewer is mounted from its first opening on, so a frame nobody opens carries none. */
  const [viewed, setViewed] = useState(false);
  const view = useCallback((event: MouseEvent<HTMLElement>) => {
    opener.current = event.currentTarget;
    setViewed(true);
    setOpen(true);
  }, []);
  /** The step the reader chose, by id; `null` follows the newest one. */
  const [chosen, setChosen] = useState<string | null>(null);
  const count = shots.length;
  const last = count - 1;
  const found = chosen == null ? -1 : shots.findIndex((shot) => shot.id === chosen);
  const index = found < 0 ? last : found;

  const go = useCallback(
    (to: number) => {
      const next = Math.min(Math.max(to, 0), last);
      setChosen(next === last ? null : (shots[next]?.id ?? null));
    },
    [last, shots],
  );

  const shot = shots[index];
  if (shot == null) {
    return null;
  }

  const name = shotName(shot);
  const position = localize('com_ui_browse_step', { 0: index + 1, 1: count });

  return (
    <figure
      aria-label={`${localize('com_ui_browse_frame')}: ${position}`}
      data-testid="browse-frame"
      className="border-border-light bg-surface-secondary my-2 w-full max-w-xl overflow-hidden rounded-xl border"
    >
      <div className="text-text-secondary flex h-9 items-center gap-1 ps-3 pe-1.5 text-xs">
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate ps-1" title={shot.page?.url ?? shot.tool}>
          {shot.page ? shortAddress(shot.page.url) : shot.tool}
        </span>
        {count > 1 && (
          <>
            <span className="shrink-0 px-1 tabular-nums" aria-hidden="true">
              {index + 1} / {count}
            </span>
            <IconButton
              size="xs"
              shape="inset"
              label={localize('com_ui_browse_previous')}
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            </IconButton>
            <IconButton
              size="xs"
              shape="inset"
              label={localize('com_ui_browse_next')}
              disabled={index === last}
              onClick={() => go(index + 1)}
            >
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </IconButton>
          </>
        )}
        <IconButton
          size="xs"
          shape="inset"
          label={localize('com_ui_browse_open')}
          aria-haspopup="dialog"
          onClick={view}
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${localize('com_ui_browse_open')}: ${name}`}
        onClick={view}
        className="border-border-light bg-surface-tertiary focus-visible:ring-focus-control block w-full cursor-zoom-in border-y focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset"
      >
        <img
          src={shot.src}
          width={shot.width}
          height={shot.height}
          alt={localize('com_ui_browse_alt', { 0: name })}
          decoding="async"
          className="block h-auto w-full"
        />
      </button>
      <figcaption className="flex h-8 min-w-0 items-center gap-2 px-3 text-xs">
        <span className="text-text-secondary shrink-0 font-mono">{shot.tool}</span>
        {(shot.note ?? shot.page?.title) != null && (
          <span
            className="text-text-primary min-w-0 truncate"
            title={shot.note ?? shot.page?.title}
          >
            {shot.note ?? shot.page?.title}
          </span>
        )}
      </figcaption>
      {viewed && (
        <BrowseViewer
          shots={shots}
          index={index}
          onIndexChange={go}
          open={open}
          onOpenChange={setOpen}
          onDownload={onDownload}
          triggerRef={opener}
        />
      )}
    </figure>
  );
}

const sameShot = (left: Shot, right: Shot): boolean =>
  left.id === right.id &&
  left.src === right.src &&
  left.tool === right.tool &&
  left.note === right.note &&
  left.page?.url === right.page?.url &&
  left.page?.title === right.page?.title;

/**
 * The host rebuilds the list on every streamed delta of the reply around it, with the same
 * pictures in it, so the frame compares the pictures and not the list.
 */
const BrowseFrame: MemoExoticComponent<typeof BrowseFrameBody> = memo(
  BrowseFrameBody,
  (previous, next) =>
    previous.onDownload === next.onDownload &&
    previous.shots.length === next.shots.length &&
    previous.shots.every((shot, index) => sameShot(shot, next.shots[index])),
);
BrowseFrame.displayName = 'BrowseFrame';

export default BrowseFrame;
