import { useCallback, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button, TooltipAnchor, cn, useLocalize } from '@librechat/client';
import {
  X,
  Globe,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowDownToLine,
} from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode, RefObject } from 'react';
import type { Shot } from './steps';
import { MAX_SCALE, PAN_STEP, ZOOM_STEP, useZoom } from './zoom';
import { shortAddress, shotName } from './steps';

/** The viewer is a raw Radix dialog at z-250, so a tooltip left at the default 150 would sit behind it. */
const TOOLTIP_Z_INDEX = 300;

export type BrowseViewerProps = {
  shots: readonly Shot[];
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (shot: Shot) => void;
  /** Takes focus back when the viewer closes. */
  triggerRef?: RefObject<HTMLElement>;
};

function Control({
  label,
  onClick,
  disabled,
  children,
  buttonRef,
  className,
  floating = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  buttonRef?: RefObject<HTMLButtonElement>;
  className?: string;
  /** Drawn over the page itself, which may be any color, so it brings its own surface. */
  floating?: boolean;
}): ReactElement {
  return (
    <TooltipAnchor
      zIndex={TOOLTIP_Z_INDEX}
      description={label}
      render={
        <Button
          ref={buttonRef}
          variant={floating ? 'carousel-nav' : 'media'}
          size="bare"
          className={cn('size-10 shrink-0', className)}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      }
    />
  );
}

/**
 * The screenshots of a browsing run, one at a time and as large as the window allows: zoom with
 * the wheel, a pinch or the controls, drag a magnified page to move around it, and step through
 * the run with the arrows or the strip of thumbnails.
 */
export default function BrowseViewer({
  shots,
  index,
  onIndexChange,
  open,
  onOpenChange,
  onDownload,
  triggerRef,
}: BrowseViewerProps): ReactElement | null {
  const localize = useLocalize();
  const closeRef = useRef<HTMLButtonElement>(null);
  /** Held in state: the dialog draws its content a render after it opens, and the strip has to
   *  be in the page before the step being shown can be scrolled into view. */
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const count = shots.length;
  const shot = shots[Math.min(index, count - 1)];
  const zoom = useZoom(shot?.id);
  const { zoomed, zoomBy, panBy, reset } = zoom;

  const go = useCallback(
    (to: number) => onIndexChange(Math.min(Math.max(to, 0), count - 1)),
    [count, onIndexChange],
  );

  /** The neighbours are fetched ahead, so stepping to one does not flash an empty stage. */
  useEffect(() => {
    if (!open) {
      return;
    }
    for (const near of [shots[index - 1], shots[index + 1]]) {
      if (near != null) {
        new Image().src = near.src;
      }
    }
  }, [open, shots, index]);

  useEffect(() => {
    strip
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [strip, index]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      /** "Previous" is where reading starts: on the right in a right-to-left layout. */
      const back = getComputedStyle(event.currentTarget).direction === 'rtl' ? 1 : -1;
      const keys: Record<string, (() => void) | undefined> = {
        ArrowLeft: () => (zoomed ? panBy(PAN_STEP, 0) : go(index + back)),
        ArrowRight: () => (zoomed ? panBy(-PAN_STEP, 0) : go(index - back)),
        ArrowUp: zoomed ? () => panBy(0, PAN_STEP) : undefined,
        ArrowDown: zoomed ? () => panBy(0, -PAN_STEP) : undefined,
        Home: () => go(0),
        End: () => go(count - 1),
        '+': () => zoomBy(ZOOM_STEP),
        '=': () => zoomBy(ZOOM_STEP),
        '-': () => zoomBy(1 / ZOOM_STEP),
        '0': reset,
      };
      const act = keys[event.key];
      if (act == null) {
        return;
      }
      event.preventDefault();
      act();
    },
    [count, go, index, panBy, reset, zoomBy, zoomed],
  );

  /** A click beside the page closes the viewer, as it does for any image; one on the page, or
   *  any click while the page is magnified and may be mid-drag, does not. */
  const handleStageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const box = zoom.image.current?.getBoundingClientRect();
      if (zoomed || box == null) {
        return;
      }
      const onPage =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!onPage) {
        onOpenChange(false);
      }
    },
    [onOpenChange, zoom.image, zoomed],
  );

  if (shot == null) {
    return null;
  }

  const position = localize('com_ui_browse_step', { 0: index + 1, 1: count });
  const name = shotName(shot);
  const { scale, x, y } = zoom.view;
  let cursor = 'cursor-zoom-in';
  if (zoom.dragging) {
    cursor = 'cursor-grabbing';
  } else if (zoomed) {
    cursor = 'cursor-grab';
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-surface-media-overlay/90 fixed inset-0 z-[250]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="browse-viewer"
          className="text-text-on-media fixed inset-0 z-[250] flex flex-col outline-hidden"
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef?.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (!zoomed) {
              return;
            }
            event.preventDefault();
            reset();
          }}
        >
          <DialogPrimitive.Title className="sr-only">{`${position}: ${name}`}</DialogPrimitive.Title>
          <div className="flex shrink-0 items-center gap-1 p-3">
            <Control
              label={localize('com_ui_close')}
              onClick={() => onOpenChange(false)}
              buttonRef={closeRef}
            >
              <X className="size-6" aria-hidden="true" />
            </Control>
            <div className="min-w-0 flex-1 px-2 text-sm">
              <div className="flex min-w-0 items-center gap-1.5">
                <Globe className="size-4 shrink-0" aria-hidden="true" />
                {shot.page?.title && <span className="min-w-0 truncate">{shot.page.title}</span>}
                {shot.page ? (
                  <a
                    href={shot.page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={localize('com_ui_browse_open_page')}
                    className="text-text-on-media/70 hover:text-text-on-media focus-visible:ring-text-on-media min-w-0 shrink-[2] truncate rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-hidden"
                  >
                    {shortAddress(shot.page.url)}
                  </a>
                ) : (
                  <span className="min-w-0 truncate">{shot.tool}</span>
                )}
              </div>
              {(shot.page != null || shot.note != null) && (
                <div className="text-text-on-media/70 flex min-w-0 items-center gap-1.5 text-xs">
                  {shot.page != null && <span className="shrink-0 font-mono">{shot.tool}</span>}
                  {shot.note != null && (
                    <span className="min-w-0 truncate" title={shot.note}>
                      {shot.note}
                    </span>
                  )}
                </div>
              )}
            </div>
            {count > 1 && (
              <span className="shrink-0 px-2 text-sm tabular-nums" aria-hidden="true">
                {index + 1} / {count}
              </span>
            )}
            <Control
              label={localize('com_ui_zoom_out')}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              disabled={!zoomed}
            >
              <ZoomOut className="size-5" aria-hidden="true" />
            </Control>
            <span
              className="hidden w-12 shrink-0 text-center text-sm tabular-nums sm:block"
              aria-label={localize('com_ui_zoom_level')}
              role="status"
            >
              {Math.round(scale * 100)}%
            </span>
            <Control
              label={localize('com_ui_zoom_in')}
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={scale >= MAX_SCALE}
            >
              <ZoomIn className="size-5" aria-hidden="true" />
            </Control>
            {zoomed && (
              <Control label={localize('com_ui_reset_zoom')} onClick={reset}>
                <RotateCcw className="size-5" aria-hidden="true" />
              </Control>
            )}
            <Control label={localize('com_ui_download')} onClick={() => onDownload(shot)}>
              <ArrowDownToLine className="size-5" aria-hidden="true" />
            </Control>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              ref={zoom.stage}
              data-testid="browse-stage"
              className={cn(
                'absolute inset-0 flex touch-none items-center justify-center overflow-hidden px-4 pb-2',
                cursor,
              )}
              onClick={handleStageClick}
              {...zoom.handlers}
            >
              <img
                ref={zoom.image}
                key={shot.id}
                src={shot.src}
                alt={localize('com_ui_browse_alt', { 0: name })}
                draggable={false}
                decoding="async"
                className={cn(
                  'block max-h-full max-w-full object-contain select-none',
                  !zoom.dragging &&
                    'transition-transform duration-100 ease-out motion-reduce:transition-none',
                )}
                style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
              />
            </div>
            {index > 0 && (
              <Control
                floating
                label={localize('com_ui_browse_previous')}
                onClick={() => go(index - 1)}
                className="absolute inset-s-3 top-1/2 -translate-y-1/2"
              >
                <ChevronLeft className="size-6 rtl:rotate-180" aria-hidden="true" />
              </Control>
            )}
            {index < count - 1 && (
              <Control
                floating
                label={localize('com_ui_browse_next')}
                onClick={() => go(index + 1)}
                className="absolute inset-e-3 top-1/2 -translate-y-1/2"
              >
                <ChevronRight className="size-6 rtl:rotate-180" aria-hidden="true" />
              </Control>
            )}
          </div>

          {count > 1 && (
            <div
              ref={setStrip}
              className="flex shrink-0 gap-2 overflow-x-auto p-3"
              data-testid="browse-strip"
            >
              {shots.map((item, at) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={localize('com_ui_browse_go_to', { 0: at + 1, 1: shotName(item) })}
                  aria-current={at === index}
                  onClick={() => go(at)}
                  className={cn(
                    'focus-visible:ring-text-on-media shrink-0 overflow-hidden rounded-md border-2 transition-opacity first:ms-auto last:me-auto focus-visible:ring-2 focus-visible:outline-hidden motion-reduce:transition-none',
                    at === index
                      ? 'border-text-on-media'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  )}
                >
                  {/* Its size is stated so the strip has its final width before any picture loads,
                      which is when the step being shown is scrolled into view. */}
                  <img
                    src={item.src}
                    width={item.width}
                    height={item.height}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="block h-12 w-auto"
                  />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
