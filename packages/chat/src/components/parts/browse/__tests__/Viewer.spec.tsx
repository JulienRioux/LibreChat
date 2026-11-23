/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import type { Shot } from '../steps';
import BrowseViewer from '../Viewer';

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual<typeof import('@librechat/client')>('@librechat/client');
  return {
    ...actual,
    useLocalize: () => (key: string, values?: Record<string, string | number>) =>
      values == null ? key : `${key}:${Object.values(values).join(',')}`,
  };
});

/** jsdom has no PointerEvent, so a pointer event fired in it would carry no position or id. */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

beforeAll(() => {
  window.PointerEvent ??= TestPointerEvent as unknown as typeof PointerEvent;
});

const shot = (n: number): Shot => ({
  id: `shot-${n}`,
  src: `/images/${n}.jpeg`,
  width: 1280,
  height: 600,
  filename: `${n}.jpeg`,
  tool: 'click',
  note: `Step ${n}`,
  page: { url: `https://example.com/${n}`, title: `Page ${n}` },
});
const shots = [shot(1), shot(2), shot(3)];

function open(props: Partial<React.ComponentProps<typeof BrowseViewer>> = {}) {
  const handlers = {
    onIndexChange: jest.fn(),
    onOpenChange: jest.fn(),
    onDownload: jest.fn(),
  };
  const view = render(<BrowseViewer shots={shots} index={1} open {...handlers} {...props} />);
  return { ...handlers, ...view };
}

const viewer = () => screen.getByTestId('browse-viewer');
const stage = () => screen.getByTestId('browse-stage');
const page = () => within(stage()).getByRole('img');
const control = (name: string) => within(viewer()).getByRole('button', { name });

/**
 * jsdom lays nothing out, so every element measures 0 by 0 and a magnified page would have no
 * room to move in. These give the stage and the fitted page the sizes a real window would: a
 * wide page that fills the width of a taller stage.
 */
function layOut() {
  const size = (element: HTMLElement) => {
    if (element.tagName === 'IMG') {
      return { width: 800, height: 375 };
    }
    return element.dataset.testid === 'browse-stage' ? { width: 800, height: 600 } : null;
  };
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function width(
    this: HTMLElement,
  ) {
    return size(this)?.width ?? 0;
  });
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(
    this: HTMLElement,
  ) {
    return size(this)?.height ?? 0;
  });
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: Element,
  ) {
    const box = size(this as HTMLElement) ?? { width: 0, height: 0 };
    /** The stage starts at the corner of the window; the page is centred in it. */
    const left = (800 - box.width) / 2;
    const top = (600 - box.height) / 2;
    return {
      left,
      top,
      width: box.width,
      height: box.height,
      right: left + box.width,
      bottom: top + box.height,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  });
}

describe('BrowseViewer', () => {
  it('shows the step it was opened on, with its page and what the step did', () => {
    open();

    expect(viewer()).toHaveAccessibleName('com_ui_browse_step:2,3: Page 2');
    expect(page()).toHaveAttribute('src', '/images/2.jpeg');
    expect(page()).toHaveAttribute('alt', 'com_ui_browse_alt:Page 2');
    expect(within(viewer()).getByText('Page 2')).toBeInTheDocument();
    expect(within(viewer()).getByText('Step 2')).toBeInTheDocument();
    expect(within(viewer()).getByText('2 / 3')).toBeInTheDocument();
  });

  it('draws nothing while closed', () => {
    open({ open: false });

    expect(screen.queryByTestId('browse-viewer')).toBeNull();
  });

  it('links the address to the page itself, in a new tab that cannot reach this one', () => {
    open();

    const link = within(viewer()).getByRole('link', { name: 'example.com/2' });
    expect(link).toHaveAttribute('href', 'https://example.com/2');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  describe('stepping through the run', () => {
    it('steps with the buttons beside the page', () => {
      const { onIndexChange } = open();

      fireEvent.click(control('com_ui_browse_next'));
      fireEvent.click(control('com_ui_browse_previous'));

      expect(onIndexChange.mock.calls).toEqual([[2], [0]]);
    });

    it('steps with the arrow keys, and jumps to either end', () => {
      const { onIndexChange } = open();

      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        fireEvent.keyDown(viewer(), { key });
      }

      expect(onIndexChange.mock.calls).toEqual([[2], [0], [0], [2]]);
    });

    it('reads the arrows the other way round in a right-to-left layout', () => {
      const { onIndexChange } = open();
      viewer().style.direction = 'rtl';

      fireEvent.keyDown(viewer(), { key: 'ArrowLeft' });

      expect(onIndexChange).toHaveBeenCalledWith(2);
    });

    it('stops at the first and the last step, with no arrow leading past either', () => {
      const first = open({ index: 0 });
      expect(within(viewer()).queryByRole('button', { name: 'com_ui_browse_previous' })).toBeNull();
      expect(control('com_ui_browse_next')).toBeInTheDocument();
      fireEvent.keyDown(viewer(), { key: 'ArrowLeft' });
      expect(first.onIndexChange).toHaveBeenLastCalledWith(0);
      first.unmount();

      const last = open({ index: 2 });
      expect(within(viewer()).queryByRole('button', { name: 'com_ui_browse_next' })).toBeNull();
      expect(control('com_ui_browse_previous')).toBeInTheDocument();
      fireEvent.keyDown(viewer(), { key: 'ArrowRight' });
      expect(last.onIndexChange).toHaveBeenLastCalledWith(2);
    });

    it('jumps to a step from the strip of thumbnails, which marks the one shown', () => {
      const { onIndexChange } = open();
      const strip = within(screen.getByTestId('browse-strip'));

      expect(strip.getAllByRole('button')).toHaveLength(3);
      expect(strip.getByRole('button', { name: 'com_ui_browse_go_to:2,Page 2' })).toHaveAttribute(
        'aria-current',
        'true',
      );
      fireEvent.click(strip.getByRole('button', { name: 'com_ui_browse_go_to:3,Page 3' }));

      expect(onIndexChange).toHaveBeenCalledWith(2);
    });

    it('brings the thumbnail of the step shown into view, on opening and on every step', () => {
      const scrolled: Array<string | null> = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        scrolled.push(this.getAttribute('aria-label'));
      };
      try {
        const { rerender, onIndexChange, onOpenChange, onDownload } = open({ index: 2 });
        expect(scrolled).toEqual(['com_ui_browse_go_to:3,Page 3']);

        rerender(
          <BrowseViewer
            shots={shots}
            index={0}
            open
            onIndexChange={onIndexChange}
            onOpenChange={onOpenChange}
            onDownload={onDownload}
          />,
        );
        expect(scrolled).toEqual(['com_ui_browse_go_to:3,Page 3', 'com_ui_browse_go_to:1,Page 1']);
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('offers nothing to step with for a single screenshot', () => {
      open({ shots: [shot(1)], index: 0 });

      expect(within(viewer()).queryByRole('button', { name: 'com_ui_browse_next' })).toBeNull();
      expect(screen.queryByTestId('browse-strip')).toBeNull();
    });

    it('leaves a key held with a modifier to the browser', () => {
      const { onIndexChange } = open();

      fireEvent.keyDown(viewer(), { key: 'ArrowRight', metaKey: true });

      expect(onIndexChange).not.toHaveBeenCalled();
    });
  });

  describe('zooming', () => {
    beforeEach(layOut);

    it('starts with the whole page in view and nothing to zoom out of', () => {
      open();

      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');
      expect(control('com_ui_zoom_out')).toBeDisabled();
      expect(within(viewer()).queryByRole('button', { name: 'com_ui_reset_zoom' })).toBeNull();
      expect(within(viewer()).getByRole('status')).toHaveTextContent('100%');
    });

    it('zooms with the controls, and back out', () => {
      open();

      fireEvent.click(control('com_ui_zoom_in'));
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1.5)');
      expect(within(viewer()).getByRole('status')).toHaveTextContent('150%');

      fireEvent.click(control('com_ui_zoom_out'));
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('zooms with the plus and minus keys, and fits the page again with zero', () => {
      open();

      fireEvent.keyDown(viewer(), { key: '+' });
      fireEvent.keyDown(viewer(), { key: '=' });
      expect(page().style.transform).toBe('translate(0px, 0px) scale(2.25)');

      fireEvent.keyDown(viewer(), { key: '-' });
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1.5)');

      fireEvent.keyDown(viewer(), { key: '0' });
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('zooms with the wheel around the pointer, and keeps the page from scrolling', () => {
      open();

      // 200px right of the stage centre (the stage is 800 wide and starts at the window edge).
      const wheel = new WheelEvent('wheel', {
        deltaY: -500,
        clientX: 600,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        stage().dispatchEvent(wheel);
      });

      expect(wheel.defaultPrevented).toBe(true);
      const scale = Math.exp(1);
      expect(page().style.transform).toBe(`translate(${200 - 200 * scale}px, 0px) scale(${scale})`);
    });

    it('jumps in on a double click, and back out on the next', () => {
      open();

      fireEvent.doubleClick(stage(), { clientX: 400, clientY: 300 });
      expect(page().style.transform).toBe('translate(0px, 0px) scale(2.5)');

      fireEvent.doubleClick(stage(), { clientX: 400, clientY: 300 });
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('moves a magnified page with the arrow keys instead of stepping', () => {
      const { onIndexChange } = open();
      fireEvent.keyDown(viewer(), { key: '+' });
      fireEvent.keyDown(viewer(), { key: '+' });

      // At 2.25× the page is 1800 by 844 in a stage of 800 by 600: 500 to spare each side, 122 above and below.
      fireEvent.keyDown(viewer(), { key: 'ArrowLeft' });
      expect(page().style.transform).toBe('translate(80px, 0px) scale(2.25)');

      fireEvent.keyDown(viewer(), { key: 'ArrowDown' });
      expect(page().style.transform).toBe('translate(80px, -80px) scale(2.25)');

      fireEvent.keyDown(viewer(), { key: 'ArrowDown' });
      expect(page().style.transform).toBe('translate(80px, -121.875px) scale(2.25)');
      expect(onIndexChange).not.toHaveBeenCalled();
    });

    it('drags a magnified page, and leaves a fitted one where it is', () => {
      open();
      const drag = (fromX: number, toX: number) => {
        fireEvent.pointerDown(stage(), { pointerId: 1, button: 0, clientX: fromX, clientY: 300 });
        fireEvent.pointerMove(stage(), { pointerId: 1, clientX: toX, clientY: 300 });
        fireEvent.pointerUp(stage(), { pointerId: 1, clientX: toX, clientY: 300 });
      };

      drag(400, 300);
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');

      fireEvent.click(control('com_ui_zoom_in'));
      drag(400, 300);
      expect(page().style.transform).toBe('translate(-100px, 0px) scale(1.5)');
    });

    it('zooms with a pinch around the point between the fingers', () => {
      open();

      fireEvent.pointerDown(stage(), {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 350,
        clientY: 300,
      });
      fireEvent.pointerDown(stage(), {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 450,
        clientY: 300,
      });
      // The fingers were 100 apart around the stage centre; now they are 200 apart around it.
      fireEvent.pointerMove(stage(), {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 250,
        clientY: 300,
      });
      fireEvent.pointerMove(stage(), {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 550,
        clientY: 300,
      });

      expect(page().style.transform).toBe('translate(0px, 0px) scale(3)');
    });

    it('starts each step with the whole page in view', () => {
      const { rerender, onIndexChange, onOpenChange, onDownload } = open();
      fireEvent.click(control('com_ui_zoom_in'));
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1.5)');

      rerender(
        <BrowseViewer
          shots={shots}
          index={2}
          open
          onIndexChange={onIndexChange}
          onOpenChange={onOpenChange}
          onDownload={onDownload}
        />,
      );

      expect(page()).toHaveAttribute('src', '/images/3.jpeg');
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('stops zooming in at its limit', () => {
      open();

      for (let press = 0; press < 8; press++) {
        fireEvent.click(control('com_ui_zoom_in'));
      }

      expect(page().style.transform).toBe('translate(0px, 0px) scale(8)');
      expect(control('com_ui_zoom_in')).toBeDisabled();
    });
  });

  describe('closing', () => {
    beforeEach(layOut);

    it('closes from its close control', () => {
      const { onOpenChange } = open();

      fireEvent.click(control('com_ui_close'));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('fits a magnified page on Escape, and closes on the next', () => {
      const { onOpenChange } = open();
      fireEvent.click(control('com_ui_zoom_in'));

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(page().style.transform).toBe('translate(0px, 0px) scale(1)');
      expect(onOpenChange).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes on a click beside the page, not on a click on it', () => {
      const { onOpenChange } = open();

      // The page is centred: 800 by 375 in a stage of 800 by 600, so it spans 112 to 487 down.
      fireEvent.click(stage(), { clientX: 400, clientY: 300 });
      expect(onOpenChange).not.toHaveBeenCalled();

      fireEvent.click(stage(), { clientX: 400, clientY: 40 });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not close on a click beside a magnified page, which may end a drag', () => {
      const { onOpenChange } = open();
      fireEvent.click(control('com_ui_zoom_in'));

      fireEvent.click(stage(), { clientX: 400, clientY: 40 });

      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  it('saves the screenshot it is showing', () => {
    const { onDownload } = open();

    fireEvent.click(control('com_ui_download'));

    expect(onDownload).toHaveBeenCalledWith(shots[1]);
  });
});
