/**
 * ApmPieChartComponent
 * Hand-rolled inline-SVG donut/pie for error distribution.
 * Signal-based, OnPush. No runtime dependencies.
 *
 * Inputs:
 *   data     — PieSlice[] ({ label, value, color? })
 *   title    — optional centre text
 *   size     — px diameter (default 180)
 *   donut    — boolean (default true)
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation, input, computed, signal,
} from '@angular/core';

export interface PieSlice {
  label: string;
  value: number;
  color?: string;
}

const DEFAULT_COLORS = [
  '#ef476f', '#ffd166', '#26547c', '#6e8d5b', '#f4a261', '#a78bfa', '#8d99ae', '#457b9d',
];

function polarToXY(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

@Component({
  selector: 'apm-pie-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="apm-pie-chart" [style.width.px]="size()" [style.height.px]="size()">
      <svg
        [attr.width]="size()"
        [attr.height]="size()"
        style="display:block"
        aria-hidden="true"
      >
        @for (slice of slices(); track slice.label) {
          <path
            [attr.d]="slice.path"
            [attr.fill]="slice.color"
            stroke="#fff"
            stroke-width="2"
            class="apm-pie-chart__slice"
            (mouseenter)="hover.set(slice)"
            (mouseleave)="hover.set(null)"
          >
            <title>{{ slice.label }}: {{ slice.pct.toFixed(1) }}%</title>
          </path>
        }
        @if (donut()) {
          <!-- donut hole -->
          <circle
            [attr.cx]="cx"
            [attr.cy]="cy"
            [attr.r]="innerR"
            fill="#fff"
          />
        }
        @if (hover()) {
          <text
            [attr.x]="cx" [attr.y]="cy - 8"
            text-anchor="middle" dominant-baseline="middle"
            font-size="12" font-weight="600" fill="#0f172a"
          >{{ hover()!.pct.toFixed(1) }}%</text>
          <text
            [attr.x]="cx" [attr.y]="cy + 10"
            text-anchor="middle" dominant-baseline="middle"
            font-size="10" fill="#64748b"
          >{{ hover()!.label }}</text>
        } @else if (title()) {
          <text
            [attr.x]="cx" [attr.y]="cy"
            text-anchor="middle" dominant-baseline="middle"
            font-size="11" fill="#64748b"
          >{{ title() }}</text>
        }
      </svg>

      <!-- Legend below -->
      <div class="apm-pie-chart__legend">
        @for (slice of slices(); track slice.label) {
          <div class="apm-pie-chart__legend-row">
            <span class="apm-pie-chart__legend-dot" [style.background]="slice.color"></span>
            <span class="apm-pie-chart__legend-label" [title]="slice.label">{{ slice.label }}</span>
            <span class="apm-pie-chart__legend-pct">{{ slice.pct.toFixed(1) }}%</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .apm-pie-chart { position:relative; display:flex; flex-direction:column; align-items:center; gap:12px; }
    .apm-pie-chart__slice { cursor:default; transition:opacity 0.1s; }
    .apm-pie-chart__slice:hover { opacity:0.85; }
    .apm-pie-chart__legend {
      display:flex; flex-direction:column; gap:4px; width:100%; max-width:200px; font-size:12px;
    }
    .apm-pie-chart__legend-row { display:flex; align-items:center; gap:6px; }
    .apm-pie-chart__legend-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
    .apm-pie-chart__legend-label { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151; }
    .apm-pie-chart__legend-pct { font-weight:600;color:#0f172a;white-space:nowrap; }
  `],
})
export class ApmPieChartComponent {
  data  = input<PieSlice[]>([]);
  title = input<string>('');
  size  = input<number>(180);
  donut = input<boolean>(true);

  get cx() { return this.size() / 2; }
  get cy() { return this.size() / 2; }
  get outerR() { return this.size() / 2 - 4; }
  get innerR() { return this.outerR * 0.55; }

  hover = signal<{ label: string; pct: number; color: string } | null>(null);

  slices = computed(() => {
    const items = this.data().filter(d => d.value > 0);
    const total = items.reduce((s, d) => s + d.value, 0);
    if (total === 0) return [];
    const cx = this.cx;
    const cy = this.cy;
    const r  = this.outerR;
    let angle = -Math.PI / 2;
    return items.map((d, i) => {
      const pct = d.value / total;
      const start = angle;
      const end = angle + pct * 2 * Math.PI;
      const [x1, y1] = polarToXY(cx, cy, r, start);
      const [x2, y2] = polarToXY(cx, cy, r, end);
      const large = pct > 0.5 ? 1 : 0;
      const path = `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large},1 ${x2},${y2} Z`;
      angle = end;
      return { label: d.label, value: d.value, pct: pct * 100, path, color: d.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] };
    });
  });
}
