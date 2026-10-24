import { describe, expect, it } from 'vitest';
import { areaPathD, finiteDots, polylinePoints } from './svg-points';

describe('svg-points', () => {
  it('builds a bare "x,y x,y" list — no path commands — for <polyline points>', () => {
    expect(polylinePoints([{ cx: 58, cy: 99 }, { cx: 95.5, cy: 40 }, { cx: 130, cy: 12 }])).toBe('58,99 95.5,40 130,12');
  });

  it('drops NaN / Infinity dots instead of emitting an invalid points attribute', () => {
    const dots = [{ cx: 1, cy: 2 }, { cx: NaN, cy: 3 }, { cx: 4, cy: Infinity }, { cx: 5, cy: 6 }];
    expect(finiteDots(dots)).toEqual([{ cx: 1, cy: 2 }, { cx: 5, cy: 6 }]);
    expect(polylinePoints(dots)).toBe('1,2 5,6');
    expect(polylinePoints(dots)).not.toMatch(/NaN|Infinity|L/);
  });

  it('returns an empty string for an empty / fully non-finite series', () => {
    expect(polylinePoints([])).toBe('');
    expect(polylinePoints([{ cx: NaN, cy: NaN }])).toBe('');
    expect(areaPathD([], 100)).toBe('');
    expect(areaPathD([{ cx: 1, cy: 2 }], NaN)).toBe('');
  });

  it('closes the area path down to the baseline', () => {
    expect(areaPathD([{ cx: 0, cy: 10 }, { cx: 20, cy: 5 }], 50)).toBe('M 0,10 L 20,5 L 20,50 L 0,50 Z');
  });
});
