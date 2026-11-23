import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { RefCallback, RefObject } from 'react';

/** How an image sits in its stage: magnification, and the offset of its centre from the stage's. */
export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** The whole image, as large as the stage allows. */
export const FIT: View = { scale: 1, x: 0, y: 0 };
export const MAX_SCALE = 8;
/** One press of a zoom control, and the level a double click jumps to. */
export const ZOOM_STEP = 1.5;
export const ZOOM_JUMP = 2.5;
/** One press of an arrow key while zoomed, in pixels. */
export const PAN_STEP = 80;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Keeps the image over the stage: an axis on which the magnified image is no larger than the
 * stage stays centred, and on the other the image cannot be dragged past its own edge.
 * `image` is its size at `FIT`.
 */
export function settle(view: View, stage: Size, image: Size): View {
  const scale = clamp(view.scale, 1, MAX_SCALE);
  if (scale === 1) {
    return FIT;
  }
  const slackX = Math.max((image.width * scale - stage.width) / 2, 0);
  const slackY = Math.max((image.height * scale - stage.height) / 2, 0);
  return { scale, x: clamp(view.x, -slackX, slackX), y: clamp(view.y, -slackY, slackY) };
}

/**
 * Changes the magnification while the spot of the image under `point` stays under it. `point`
 * is measured from the centre of the stage.
 */
export function zoomAt(view: View, scale: number, point: Point, stage: Size, image: Size): View {
  const next = clamp(scale, 1, MAX_SCALE);
  const ratio = next / view.scale;
  return settle(
    {
      scale: next,
      x: point.x - (point.x - view.x) * ratio,
      y: point.y - (point.y - view.y) * ratio,
    },
    stage,
    image,
  );
}

export type Zoom = {
  view: View;
  zoomed: boolean;
  /** Goes on the element the image is shown in; it takes the pointer and wheel input. */
  stage: RefCallback<HTMLDivElement>;
  image: RefObject<HTMLImageElement>;
  /** True while a pointer is moving a magnified image. */
  dragging: boolean;
  zoomBy: (factor: number) => void;
  panBy: (x: number, y: number) => void;
  reset: () => void;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
};

const sizeOf = (element: HTMLElement | null): Size => ({
  width: element?.offsetWidth ?? 0,
  height: element?.offsetHeight ?? 0,
});

const CENTRE: Point = { x: 0, y: 0 };
const same = (scale: number): number => scale;

/**
 * Zoom and pan for one image in a stage: wheel and pinch magnify around the pointer, a drag
 * moves a magnified image, a double click jumps in and back out. Whatever shows `subject`
 * starts at `FIT` again when the subject changes.
 */
export function useZoom(subject: unknown): Zoom {
  const box = useRef<HTMLDivElement | null>(null);
  /** Also held in state, so the wheel listener is attached once the stage is in the page. */
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const stage = useCallback((node: HTMLDivElement | null) => {
    box.current = node;
    setElement(node);
  }, []);
  const image = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [held, setHeld] = useState(false);
  /** Pointers currently down on the stage, by id, at their last position. */
  const pointers = useRef(new Map<number, Point>());

  useEffect(() => {
    setView(FIT);
    setHeld(false);
    pointers.current.clear();
  }, [subject]);

  /** A position on the page, measured from the centre of the stage. */
  const fromCentre = useCallback((clientX: number, clientY: number): Point => {
    const rect = box.current?.getBoundingClientRect();
    if (rect == null) {
      return { x: 0, y: 0 };
    }
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  /** Moves the image by `pan`, then changes its magnification around `point`, as one step. */
  const change = useCallback(
    (scale: (current: number) => number, point: Point = CENTRE, pan: Point = CENTRE) => {
      setView((current) =>
        zoomAt(
          { scale: current.scale, x: current.x + pan.x, y: current.y + pan.y },
          scale(current.scale),
          point,
          sizeOf(box.current),
          sizeOf(image.current),
        ),
      );
    },
    [],
  );

  const zoomBy = useCallback((factor: number) => change((scale) => scale * factor), [change]);
  const panBy = useCallback((x: number, y: number) => change(same, CENTRE, { x, y }), [change]);

  const reset = useCallback(() => setView(FIT), []);

  /** React listens to the wheel passively, and a pinch on a trackpad arrives as a wheel event the
   *  browser would answer by zooming the whole page: this listener has to be able to cancel it. */
  useEffect(() => {
    if (element == null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const speed = event.ctrlKey ? 0.01 : 0.002;
      const factor = Math.exp(-event.deltaY * speed);
      change((scale) => scale * factor, fromCentre(event.clientX, event.clientY));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element, fromCentre, change]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setHeld(true);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const last = pointers.current.get(event.pointerId);
      if (last == null) {
        return;
      }
      const now = { x: event.clientX, y: event.clientY };
      const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
      pointers.current.set(event.pointerId, now);
      if (other == null) {
        panBy(now.x - last.x, now.y - last.y);
        return;
      }
      /** Two fingers: the image follows the point midway between them, and the spread between
       *  them sets the magnification around that point. */
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before === 0) {
        return;
      }
      const from = fromCentre((last.x + other.x) / 2, (last.y + other.y) / 2);
      const middle = fromCentre((now.x + other.x) / 2, (now.y + other.y) / 2);
      change((scale) => (scale * after) / before, middle, {
        x: middle.x - from.x,
        y: middle.y - from.y,
      });
    },
    [fromCentre, panBy, change],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setHeld(pointers.current.size > 0);
  }, []);

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const point = fromCentre(event.clientX, event.clientY);
      change((scale) => (scale > 1 ? 1 : ZOOM_JUMP), point);
    },
    [fromCentre, change],
  );

  return {
    view,
    zoomed: view.scale > 1,
    stage,
    image,
    dragging: held && view.scale > 1,
    zoomBy,
    panBy,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
    },
  };
}
