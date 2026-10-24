/**
 * SVG point helpers shared by the hand-rolled charts.
 *
 * `<polyline points>` takes a bare list of `x,y` pairs ("10,20 30,40"). The charts used to build it with
 * path syntax ("10,20 L 30,40"), which the browser rejects at the `L` ("Expected number") and which also
 * truncated the drawn line after the first point. A non-finite coordinate (NaN/Infinity from a zero-range
 * axis or an empty series) is rejected the same way, so those points are dropped here rather than emitted.
 */
export interface ChartDot {
  cx: number;
  cy: number;
}

/** The dots whose coordinates are both finite numbers. */
export function finiteDots<T extends ChartDot>(dots: readonly T[]): T[] {
  return dots.filter(d => Number.isFinite(d.cx) && Number.isFinite(d.cy));
}

/** A valid `<polyline points>` value ("x,y x,y …") from the finite dots; '' when fewer than one remains. */
export function polylinePoints(dots: readonly ChartDot[]): string {
  return finiteDots(dots).map(d => `${d.cx},${d.cy}`).join(' ');
}

/** A closed `<path d>` area under the finite dots down to `baseY`; '' when there is nothing finite to draw. */
export function areaPathD(dots: readonly ChartDot[], baseY: number): string {
  const pts = finiteDots(dots);
  if (!pts.length || !Number.isFinite(baseY)) return '';
  const top = pts.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.cx},${d.cy}`).join(' ');
  return `${top} L ${pts[pts.length - 1].cx},${baseY} L ${pts[0].cx},${baseY} Z`;
}
