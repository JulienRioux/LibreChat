import { FIT, MAX_SCALE, settle, zoomAt } from '../zoom';

/** A wide page in a taller stage: fitted, it fills the width and leaves room above and below. */
const stage = { width: 800, height: 600 };
const image = { width: 800, height: 375 };
const centre = { x: 0, y: 0 };

describe('settle', () => {
  it('returns to the fitted view at no magnification, wherever the image was', () => {
    expect(settle({ scale: 1, x: 120, y: -40 }, stage, image)).toBe(FIT);
    expect(settle({ scale: 0.4, x: 0, y: 0 }, stage, image)).toBe(FIT);
  });

  it('keeps an axis centred while the magnified image still fits the stage on it', () => {
    // 375 × 1.5 = 562 high, inside the 600 of the stage; 800 × 1.5 = 1200 wide, 200 over each side.
    expect(settle({ scale: 1.5, x: 50, y: 90 }, stage, image)).toEqual({ scale: 1.5, x: 50, y: 0 });
  });

  it('stops the image at its own edge', () => {
    expect(settle({ scale: 2, x: 5000, y: -5000 }, stage, image)).toEqual({
      scale: 2,
      x: 400,
      y: -75,
    });
  });

  it('caps the magnification', () => {
    expect(settle({ scale: 50, x: 0, y: 0 }, stage, image).scale).toBe(MAX_SCALE);
  });
});

describe('zoomAt', () => {
  it('magnifies around the centre without moving the image', () => {
    expect(zoomAt(FIT, 2, centre, stage, image)).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('keeps the spot under the pointer where it is', () => {
    const point = { x: 200, y: 0 };
    const view = zoomAt(FIT, 2, point, stage, image);
    // The spot 200px right of centre was at image offset 200; at 2× it sits at 400 + x.
    expect(view).toEqual({ scale: 2, x: -200, y: 0 });
    expect(200 * view.scale + view.x).toBe(point.x);
  });

  it('keeps that spot through a second step, from a view already moved', () => {
    const point = { x: 100, y: 50 };
    const first = zoomAt(FIT, 2, point, stage, image);
    const spot = { x: (point.x - first.x) / first.scale, y: (point.y - first.y) / first.scale };
    const second = zoomAt(first, 4, point, stage, image);
    expect(spot.x * second.scale + second.x).toBeCloseTo(point.x);
    expect(spot.y * second.scale + second.y).toBeCloseTo(point.y);
  });

  it('settles back to the fitted view when zoomed all the way out', () => {
    const zoomed = zoomAt(FIT, 3, { x: 300, y: 100 }, stage, image);
    expect(zoomAt(zoomed, 0.5, { x: -300, y: 0 }, stage, image)).toBe(FIT);
  });

  it('does not let a zoom toward a corner drag the image past its edge', () => {
    const view = zoomAt(FIT, 2, { x: 400, y: 300 }, stage, image);
    expect(view).toEqual({ scale: 2, x: -400, y: -75 });
  });
});
