/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Shot } from '../steps';
import BrowseFrame from '../Frame';

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual<typeof import('@librechat/client')>('@librechat/client');
  return {
    ...actual,
    /** The key, then the values it was given, so a test can read a position out of a label. */
    useLocalize: () => (key: string, values?: Record<string, string | number>) =>
      values == null ? key : `${key}:${Object.values(values).join(',')}`,
  };
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
const run = (count: number): Shot[] => Array.from({ length: count }, (_, at) => shot(at + 1));

const frame = () => screen.getByTestId('browse-frame');
const picture = () => within(frame()).getByRole('img');
const previous = () => within(frame()).getByRole('button', { name: 'com_ui_browse_previous' });
const next = () => within(frame()).getByRole('button', { name: 'com_ui_browse_next' });

describe('BrowseFrame', () => {
  it('shows the newest step: its screenshot, where the browser was and what the step did', () => {
    render(<BrowseFrame shots={run(3)} onDownload={jest.fn()} />);

    expect(picture()).toHaveAttribute('src', '/images/3.jpeg');
    expect(picture()).toHaveAttribute('alt', 'com_ui_browse_alt:Page 3');
    expect(frame()).toHaveAccessibleName('com_ui_browse_frame: com_ui_browse_step:3,3');
    expect(within(frame()).getByText('example.com/3')).toBeInTheDocument();
    expect(within(frame()).getByText('3 / 3')).toBeInTheDocument();
    expect(within(frame()).getByText('click')).toBeInTheDocument();
    expect(within(frame()).getByText('Step 3')).toBeInTheDocument();
  });

  it('reserves the room the screenshot takes before it has loaded', () => {
    render(<BrowseFrame shots={run(1)} onDownload={jest.fn()} />);

    expect(picture()).toHaveAttribute('width', '1280');
    expect(picture()).toHaveAttribute('height', '600');
  });

  it('steps back and forward through the run, and stops at its ends', () => {
    render(<BrowseFrame shots={run(3)} onDownload={jest.fn()} />);
    expect(next()).toBeDisabled();

    fireEvent.click(previous());
    expect(picture()).toHaveAttribute('src', '/images/2.jpeg');
    expect(within(frame()).getByText('2 / 3')).toBeInTheDocument();
    expect(next()).toBeEnabled();

    fireEvent.click(previous());
    expect(picture()).toHaveAttribute('src', '/images/1.jpeg');
    expect(previous()).toBeDisabled();

    fireEvent.click(next());
    expect(picture()).toHaveAttribute('src', '/images/2.jpeg');
  });

  it('follows the newest step as more arrive', () => {
    const { rerender } = render(<BrowseFrame shots={run(2)} onDownload={jest.fn()} />);
    expect(picture()).toHaveAttribute('src', '/images/2.jpeg');

    rerender(<BrowseFrame shots={run(3)} onDownload={jest.fn()} />);
    expect(picture()).toHaveAttribute('src', '/images/3.jpeg');
    expect(within(frame()).getByText('3 / 3')).toBeInTheDocument();
  });

  it('stays on the step the reader went back to while more arrive', () => {
    const onDownload = jest.fn();
    const { rerender } = render(<BrowseFrame shots={run(3)} onDownload={onDownload} />);
    fireEvent.click(previous());

    rerender(<BrowseFrame shots={run(4)} onDownload={onDownload} />);
    expect(picture()).toHaveAttribute('src', '/images/2.jpeg');
    expect(within(frame()).getByText('2 / 4')).toBeInTheDocument();
  });

  it('follows again once the reader is back on the newest step', () => {
    const onDownload = jest.fn();
    const { rerender } = render(<BrowseFrame shots={run(3)} onDownload={onDownload} />);
    fireEvent.click(previous());
    fireEvent.click(next());

    rerender(<BrowseFrame shots={run(4)} onDownload={onDownload} />);
    expect(picture()).toHaveAttribute('src', '/images/4.jpeg');
  });

  it('shows a single screenshot without anything to step with', () => {
    render(<BrowseFrame shots={run(1)} onDownload={jest.fn()} />);

    expect(picture()).toHaveAttribute('src', '/images/1.jpeg');
    expect(within(frame()).queryByRole('button', { name: 'com_ui_browse_previous' })).toBeNull();
    expect(within(frame()).queryByRole('button', { name: 'com_ui_browse_next' })).toBeNull();
    expect(within(frame()).queryByText('1 / 1')).toBeNull();
  });

  it('names a step by its tool when its result named no page', () => {
    const bare: Shot = { id: 'a', src: '/a.jpeg', filename: 'a.jpeg', tool: 'get_chart' };
    render(<BrowseFrame shots={[bare]} onDownload={jest.fn()} />);

    expect(picture()).toHaveAttribute('alt', 'com_ui_browse_alt:get_chart');
    expect(within(frame()).getAllByText('get_chart')).toHaveLength(2);
  });

  it('draws nothing without a screenshot', () => {
    const { container } = render(<BrowseFrame shots={[]} onDownload={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('opens the viewer on the step it shows', () => {
    render(<BrowseFrame shots={run(3)} onDownload={jest.fn()} />);
    fireEvent.click(previous());
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(frame()).getByRole('button', { name: 'com_ui_browse_open: Page 2' }));

    const viewer = screen.getByRole('dialog');
    expect(viewer).toHaveAccessibleName('com_ui_browse_step:2,3: Page 2');
    expect(within(screen.getByTestId('browse-stage')).getByRole('img')).toHaveAttribute(
      'src',
      '/images/2.jpeg',
    );
  });

  it('opens the viewer from the control in its header too', () => {
    render(<BrowseFrame shots={run(2)} onDownload={jest.fn()} />);

    fireEvent.click(within(frame()).getByRole('button', { name: 'com_ui_browse_open' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the frame on the step the reader moved to inside the viewer', () => {
    render(<BrowseFrame shots={run(3)} onDownload={jest.fn()} />);
    fireEvent.click(within(frame()).getByRole('button', { name: 'com_ui_browse_open: Page 3' }));

    const viewer = screen.getByRole('dialog');
    fireEvent.click(within(viewer).getByRole('button', { name: 'com_ui_browse_previous' }));
    fireEvent.click(within(viewer).getByRole('button', { name: 'com_ui_close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(picture()).toHaveAttribute('src', '/images/2.jpeg');
  });

  it('saves the screenshot the viewer is showing', () => {
    const onDownload = jest.fn();
    const shots = run(2);
    render(<BrowseFrame shots={shots} onDownload={onDownload} />);
    fireEvent.click(within(frame()).getByRole('button', { name: 'com_ui_browse_open: Page 2' }));

    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'com_ui_download' }),
    );

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith(shots[1]);
  });
});
