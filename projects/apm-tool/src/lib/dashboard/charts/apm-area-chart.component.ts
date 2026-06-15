/**
 * ApmAreaChartComponent
 * Hand-rolled inline-SVG: area fill + polyline for Page Performance.
 * Supports multi-series line overlay (for detailed Core Web Vitals view).
 * Responsive via ResizeObserver. Signal-based, OnPush.
 *
 * Inputs:
 *   data          — ChartDataPoint[]
 *   areaKey       — primary metric key (area fill + line)
 *   extraLines    — [{ key, color, label }] for multi-line overlay
 *   xLabelFn      — display label for x-tick
 *   xFullLabelFn  — full label for tooltip
 *   leftAxisLabel — Y-axis label
 *   height        — px, default 256
 *   areaColor     — stroke + fill colour (default '#26547c')
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  ElementRef, viewChild, input, computed, effect, signal, OnDestroy, PLATFORM_ID, inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ChartDataPoint } from './apm-combo-chart.component';

export interface ExtraLine {
  key: string;
  color: string;
  label: string;
}

@Component({
  selector: 'apm-area-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="apm-area-chart" [style.height.px]="height()">
      @if (data().length === 0) {
        <div class="apm-area-chart__empty">No data</div>
      } @else {
        <!-- Legend -->
        @if (showLegend()) {
          <div class="apm-area-chart__legend">
            <span class="apm-area-chart__legend-item">
              <span class="apm-area-chart__legend-swatch" [style.background]="areaColor()"></span>
              {{ areaLabel() }}
            </span>
            @for (line of extraLines(); track line.key) {
              <span class="apm-area-chart__legend-item">
                <span class="apm-area-chart__legend-swatch" [style.background]="line.color"></span>
                {{ line.label }}
              </span>
            }
          </div>
        }

        <div class="apm-area-chart__svg-wrap" #svgWrap>
          <svg
            [attr.width]="svgWidth()"
            [attr.height]="svgHeight()"
            style="display:block;overflow:visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient [id]="gradId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" [attr.stop-color]="areaColor()" stop-opacity="0.2"/>
                <stop offset="100%" [attr.stop-color]="areaColor()" stop-opacity="0.02"/>
              </linearGradient>
            </defs>

            <!-- Grid -->
            @for (tick of yTicks(); track tick.value) {
              <line
                [attr.x1]="margins.left"
                [attr.x2]="svgWidth() - margins.right"
                [attr.y1]="tick.y" [attr.y2]="tick.y"
                stroke="#e5e7eb" stroke-dasharray="3 3" stroke-width="1"
              />
            }

            <!-- Left axis -->
            <line
              [attr.x1]="margins.left" [attr.x2]="margins.left"
              [attr.y1]="margins.top" [attr.y2]="svgHeight() - margins.bottom"
              stroke="#e5e7eb" stroke-width="1"
            />
            @for (tick of yTicks(); track tick.value) {
              <text
                [attr.x]="margins.left - 6" [attr.y]="tick.y"
                text-anchor="end" dominant-baseline="middle"
                font-size="11" fill="#64748b"
              >{{ fmtY(tick.value) }}</text>
            }
            @if (leftAxisLabel()) {
              <text
                [attr.x]="12"
                [attr.y]="margins.top + plotHeight() / 2"
                text-anchor="middle" dominant-baseline="middle"
                font-size="11" fill="#64748b"
                [attr.transform]="'rotate(-90,12,' + (margins.top + plotHeight() / 2) + ')'"
              >{{ leftAxisLabel() }}</text>
            }

            <!-- Area fill -->
            @if (areaPath()) {
              <path [attr.d]="areaPath()" [attr.fill]="'url(#' + gradId + ')'" />
              <polyline
                [attr.points]="linePath()"
                fill="none"
                [attr.stroke]="areaColor()"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            }

            <!-- Extra lines -->
            @for (el of extraLines(); track el.key) {
              <polyline
                [attr.points]="extraLinePath(el.key)"
                fill="none"
                [attr.stroke]="el.color"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              @for (pt of extraLineDots(el.key); track pt.index) {
                <circle
                  [attr.cx]="pt.cx" [attr.cy]="pt.cy"
                  r="3" [attr.fill]="el.color" stroke="#fff" stroke-width="1.5"
                />
              }
            }

            <!-- Hover dots on area line -->
            @for (dot of mainDots(); track dot.index) {
              <circle
                [attr.cx]="dot.cx" [attr.cy]="dot.cy"
                r="4" [attr.fill]="areaColor()" stroke="#fff" stroke-width="2"
                class="apm-area-chart__dot"
                (mouseenter)="showTooltip($event, dot.item)"
                (mouseleave)="hideTooltip()"
              />
            }

            <!-- X-tick labels -->
            @for (dot of mainDots(); track dot.index) {
              <g [attr.transform]="'translate(' + dot.cx + ',' + (svgHeight() - margins.bottom + 5) + ')'">
                <text
                  x="-5" y="10"
                  text-anchor="end" font-size="11" fill="#64748b"
                  transform="rotate(-35)"
                >{{ xLabelFn()(dot.item) }}</text>
              </g>
            }
          </svg>
        </div>

        @if (tooltipVisible()) {
          <div
            class="apm-area-chart__tooltip"
            [style.left.px]="tooltipX()"
            [style.top.px]="tooltipY()"
          >
            <div class="tt-title">{{ xFullLabelFn()(tooltipItem()!) }}</div>
            @if (areaKey()) {
              <div class="tt-row">
                <span>{{ areaLabel() }}</span>
                <span class="tt-val">{{ fmtY(+tooltipItem()![areaKey()]) }}</span>
              </div>
            }
            @for (el of extraLines(); track el.key) {
              <div class="tt-row">
                <span>{{ el.label }}</span>
                <span class="tt-val">{{ fmtY(+tooltipItem()![el.key]) }}</span>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .apm-area-chart { position: relative; width: 100%; display: flex; flex-direction: column; }
    .apm-area-chart__empty { display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:13px; }
    .apm-area-chart__legend { display:flex;gap:14px;margin-bottom:6px;font-size:12px;color:#64748b;padding-left:4px; }
    .apm-area-chart__legend-item { display:inline-flex;align-items:center;gap:6px; }
    .apm-area-chart__legend-swatch { width:14px;height:3px;border-radius:2px;display:inline-block; }
    .apm-area-chart__svg-wrap { flex:1;min-height:0;overflow:visible; }
    .apm-area-chart__dot { cursor:default; }
    .apm-area-chart__tooltip {
      position:absolute;z-index:100;background:#fff;border:1px solid #e5e7eb;
      border-radius:8px;padding:10px 12px;font-size:12px;
      box-shadow:0 4px 16px rgba(15,23,42,0.12);min-width:180px;
      pointer-events:none;white-space:nowrap;
    }
    .tt-title { font-weight:600;color:#0f172a;margin-bottom:4px; }
    .tt-row { display:flex;justify-content:space-between;gap:12px;color:#374151;line-height:1.6; }
    .tt-val { font-weight:600;color:#0f172a; }
  `],
})
export class ApmAreaChartComponent implements OnDestroy {
  data         = input<ChartDataPoint[]>([]);
  areaKey      = input<string>('');
  areaLabel    = input<string>('Value');
  areaColor    = input<string>('#26547c');
  extraLines   = input<ExtraLine[]>([]);
  xLabelFn     = input<(item: ChartDataPoint) => string>((item) => String(item['name'] ?? ''));
  xFullLabelFn = input<(item: ChartDataPoint) => string>((item) => String(item['name'] ?? ''));
  leftAxisLabel = input<string>('');
  height       = input<number>(256);
  showLegend   = input<boolean>(false);

  readonly gradId = `apm-area-grad-${Math.random().toString(36).slice(2)}`;

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private svgWrapRef = viewChild<ElementRef<HTMLDivElement>>('svgWrap');
  private ro: ResizeObserver | undefined;
  private _cw = signal(640);

  svgWidth  = computed(() => this._cw());
  svgHeight = computed(() => this.height() - (this.showLegend() ? 28 : 0));
  readonly margins = { top: 16, right: 20, bottom: 60, left: 58 };
  plotWidth  = computed(() => Math.max(0, this.svgWidth() - this.margins.left - this.margins.right));
  plotHeight = computed(() => Math.max(0, this.svgHeight() - this.margins.top - this.margins.bottom));

  private yMax = computed(() => {
    const keys = [this.areaKey(), ...this.extraLines().map(l => l.key)].filter(Boolean);
    const vals = this.data().flatMap(d => keys.map(k => Number(d[k]) || 0));
    return Math.max(...vals, 1);
  });

  yTicks = computed(() => {
    const steps = 5;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = (this.yMax() / steps) * i;
      const y = this.margins.top + this.plotHeight() - (value / this.yMax()) * this.plotHeight();
      return { value, y };
    }).reverse();
  });

  private xFor = computed(() => {
    const n = this.data().length;
    const step = n > 1 ? this.plotWidth() / (n - 1) : this.plotWidth() / 2;
    return (index: number) => this.margins.left + (n > 1 ? step * index : this.plotWidth() / 2);
  });

  private yFor = (v: number) => this.margins.top + this.plotHeight() - (v / this.yMax()) * this.plotHeight();

  mainDots = computed(() =>
    this.data().map((item, index) => ({
      index, item,
      cx: this.xFor()(index),
      cy: this.yFor(Number(item[this.areaKey()]) || 0),
    }))
  );

  linePath = computed(() => this.mainDots().map((d, i) => `${i === 0 ? '' : 'L '}${d.cx},${d.cy}`).join(' ').trim());
  areaPath = computed(() => {
    const dots = this.mainDots();
    if (!dots.length) return '';
    const base = this.margins.top + this.plotHeight();
    const top = dots.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.cx},${d.cy}`).join(' ');
    return `${top} L ${dots[dots.length - 1].cx},${base} L ${dots[0].cx},${base} Z`;
  });

  extraLinePath(key: string): string {
    const n = this.data().length;
    const xFor = this.xFor();
    return this.data().map((d, i) => `${i === 0 ? '' : 'L '}${xFor(i)},${this.yFor(Number(d[key]) || 0)}`).join(' ').trim();
  }

  extraLineDots(key: string): { index: number; cx: number; cy: number }[] {
    const xFor = this.xFor();
    return this.data().map((d, i) => ({ index: i, cx: xFor(i), cy: this.yFor(Number(d[key]) || 0) }));
  }

  fmtY(v: number): string { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString(); }

  tooltipVisible = signal(false);
  tooltipX = signal(0);
  tooltipY = signal(0);
  tooltipItem = signal<ChartDataPoint | null>(null);

  showTooltip(event: MouseEvent, item: ChartDataPoint): void {
    this.tooltipItem.set(item);
    this.tooltipVisible.set(true);
    const rect = (event.currentTarget as Element).closest('.apm-area-chart')?.getBoundingClientRect();
    if (!rect) return;
    this.tooltipX.set(event.clientX - rect.left + 12);
    this.tooltipY.set(event.clientY - rect.top - 20);
  }
  hideTooltip(): void { this.tooltipVisible.set(false); }

  constructor() {
    effect(() => {
      const el = this.svgWrapRef()?.nativeElement;
      if (!el || !this.isBrowser) return;
      this.ro?.disconnect();
      this.ro = new ResizeObserver(e => this._cw.set(Math.max(200, e[0]?.contentRect.width ?? 640)));
      this.ro.observe(el);
      this._cw.set(Math.max(200, el.clientWidth || 640));
    });
  }
  ngOnDestroy(): void { this.ro?.disconnect(); }
}
