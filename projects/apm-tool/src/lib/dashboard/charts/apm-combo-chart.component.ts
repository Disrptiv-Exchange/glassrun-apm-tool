/**
 * ApmComboChartComponent
 * Hand-rolled inline-SVG chart: vertical bars (left Y axis) + optional
 * overlaid polyline (right Y axis). Responsive via ResizeObserver.
 * Signal-based, OnPush.
 *
 * Inputs:
 *   data          — ChartDataPoint[] (required)
 *   barKey        — keyof ChartDataPoint to drive bar heights
 *   lineKey       — keyof ChartDataPoint to drive line (omit to hide line)
 *   barLabel      — Legend label for bars
 *   lineLabel     — Legend label for line
 *   leftAxisLabel — Y-axis label (left)
 *   rightAxisLabel— Y-axis label (right)
 *   height        — px, default 256
 *   barColorFn    — (value: number, item: ChartDataPoint) => string
 *   xLabelFn      — (item: ChartDataPoint) => string   (x-tick display)
 *   xFullLabelFn  — (item: ChartDataPoint) => string   (tooltip full label)
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  ElementRef, viewChild, input, computed, effect, signal,
  OnDestroy, PLATFORM_ID, inject,
} from '@angular/core';
import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';

export interface ChartDataPoint {
  [key: string]: any;
}

@Component({
  selector: 'apm-combo-chart',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="apm-combo-chart" [style.height.px]="height()">
      @if (data().length === 0) {
        <div class="apm-combo-chart__empty">No data</div>
      } @else {
        <!-- Legend -->
        <div class="apm-combo-chart__legend">
          <span class="apm-combo-chart__legend-item">
            <span class="apm-combo-chart__legend-bar" [style.background]="barLegendColor()"></span>
            {{ barLabel() }}
          </span>
          @if (lineKey()) {
            <span class="apm-combo-chart__legend-item">
              <span class="apm-combo-chart__legend-line" [style.background]="'#f4a261'"></span>
              {{ lineLabel() }}
            </span>
          }
        </div>

        <!-- SVG canvas -->
        <div class="apm-combo-chart__svg-wrap" #svgWrap>
          <svg
            [attr.width]="svgWidth()"
            [attr.height]="svgHeight()"
            style="display:block;overflow:visible"
            aria-hidden="true"
          >
            <!-- Grid lines -->
            @for (tick of leftTicks(); track tick.value) {
              <line
                [attr.x1]="margins.left"
                [attr.x2]="svgWidth() - margins.right"
                [attr.y1]="tick.y"
                [attr.y2]="tick.y"
                stroke="#e5e7eb"
                stroke-dasharray="3 3"
                stroke-width="1"
              />
            }

            <!-- Left Y axis -->
            <line
              [attr.x1]="margins.left"
              [attr.x2]="margins.left"
              [attr.y1]="margins.top"
              [attr.y2]="svgHeight() - margins.bottom"
              stroke="#e5e7eb"
              stroke-width="1"
            />

            <!-- Left axis ticks + labels -->
            @for (tick of leftTicks(); track tick.value) {
              <text
                [attr.x]="margins.left - 6"
                [attr.y]="tick.y"
                text-anchor="end"
                dominant-baseline="middle"
                font-size="11"
                fill="#64748b"
              >{{ formatLeft(tick.value) }}</text>
            }

            <!-- Left axis label -->
            @if (leftAxisLabel()) {
              <text
                [attr.x]="14"
                [attr.y]="margins.top + plotHeight() / 2"
                text-anchor="middle"
                dominant-baseline="middle"
                font-size="11"
                fill="#64748b"
                [attr.transform]="'rotate(-90,' + 14 + ',' + (margins.top + plotHeight() / 2) + ')'"
              >{{ leftAxisLabel() }}</text>
            }

            <!-- Right Y axis + ticks (only when line is shown) -->
            @if (lineKey() && rightTicks().length) {
              <line
                [attr.x1]="svgWidth() - margins.right"
                [attr.x2]="svgWidth() - margins.right"
                [attr.y1]="margins.top"
                [attr.y2]="svgHeight() - margins.bottom"
                stroke="#e5e7eb"
                stroke-width="1"
              />
              @for (tick of rightTicks(); track tick.value) {
                <text
                  [attr.x]="svgWidth() - margins.right + 6"
                  [attr.y]="tick.y"
                  text-anchor="start"
                  dominant-baseline="middle"
                  font-size="11"
                  fill="#64748b"
                >{{ formatRight(tick.value) }}</text>
              }
              @if (rightAxisLabel()) {
                <text
                  [attr.x]="svgWidth() - 12"
                  [attr.y]="margins.top + plotHeight() / 2"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  font-size="11"
                  fill="#64748b"
                  [attr.transform]="'rotate(90,' + (svgWidth() - 12) + ',' + (margins.top + plotHeight() / 2) + ')'"
                >{{ rightAxisLabel() }}</text>
              }
            }

            <!-- Bars -->
            @for (bar of bars(); track bar.index) {
              <rect
                [attr.x]="bar.x"
                [attr.y]="bar.y"
                [attr.width]="bar.w"
                [attr.height]="bar.h"
                [attr.fill]="bar.color"
                rx="3" ry="3"
                class="apm-combo-chart__bar"
                (mouseenter)="showTooltip($event, bar.item)"
                (mouseleave)="hideTooltip()"
              />
            }

            <!-- Line -->
            @if (lineKey() && linePath()) {
              <polyline
                [attr.points]="linePath()"
                fill="none"
                stroke="#f4a261"
                stroke-width="2.5"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              @for (dot of lineDots(); track dot.index) {
                <circle
                  [attr.cx]="dot.cx"
                  [attr.cy]="dot.cy"
                  r="4"
                  fill="#f4a261"
                  stroke="#fff"
                  stroke-width="2"
                  class="apm-combo-chart__dot"
                  (mouseenter)="showTooltip($event, dot.item)"
                  (mouseleave)="hideTooltip()"
                />
              }
            }

            <!-- X axis labels (rotated -35°) -->
            @for (bar of bars(); track bar.index) {
              <g [attr.transform]="'translate(' + (bar.x + bar.w / 2) + ',' + (svgHeight() - margins.bottom + 5) + ')'">
                <text
                  x="-5" y="10"
                  text-anchor="end"
                  font-size="11"
                  fill="#64748b"
                  transform="rotate(-35)"
                  class="apm-combo-chart__xtick"
                >{{ xLabelFn()(bar.item) }}</text>
              </g>
            }
          </svg>
        </div>

        <!-- Tooltip -->
        @if (tooltipVisible()) {
          <div
            class="apm-combo-chart__tooltip"
            [style.left.px]="tooltipX()"
            [style.top.px]="tooltipY()"
          >
            <ng-container *ngTemplateOutlet="tooltipTpl; context: { $implicit: tooltipItem() }"></ng-container>
            @if (!tooltipTpl) {
              <div class="apm-combo-chart__tt-row tt-title">{{ xFullLabelFn()(tooltipItem()!) }}</div>
              @if (barKey()) {
                <div class="apm-combo-chart__tt-row">
                  <span>{{ barLabel() }}</span>
                  <span class="tt-val">{{ tooltipItem()![barKey()!] }}</span>
                </div>
              }
              @if (lineKey()) {
                <div class="apm-combo-chart__tt-row">
                  <span>{{ lineLabel() }}</span>
                  <span class="tt-val">{{ tooltipItem()![lineKey()!] }}</span>
                </div>
              }
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .apm-combo-chart {
      position: relative;
      width: 100%;
      display: flex;
      flex-direction: column;
    }
    .apm-combo-chart__empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #64748b;
      font-size: 13px;
    }
    .apm-combo-chart__legend {
      display: flex;
      gap: 16px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #64748b;
      padding-left: 4px;
    }
    .apm-combo-chart__legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .apm-combo-chart__legend-bar {
      width: 12px; height: 10px;
      border-radius: 2px;
      display: inline-block;
    }
    .apm-combo-chart__legend-line {
      width: 16px; height: 3px;
      border-radius: 2px;
      display: inline-block;
    }
    .apm-combo-chart__svg-wrap {
      flex: 1;
      min-height: 0;
      overflow: visible;
    }
    .apm-combo-chart__bar { cursor: default; transition: opacity 0.1s; }
    .apm-combo-chart__bar:hover { opacity: 0.8; }
    .apm-combo-chart__dot { cursor: default; }
    .apm-combo-chart__xtick { cursor: default; }
    .apm-combo-chart__tooltip {
      position: absolute;
      z-index: 100;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
      box-shadow: 0 4px 16px rgba(15,23,42,0.12);
      min-width: 180px;
      pointer-events: none;
      white-space: nowrap;
    }
    .apm-combo-chart__tt-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      line-height: 1.6;
      color: #374151;
    }
    .apm-combo-chart__tt-row.tt-title {
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
      justify-content: flex-start;
    }
    .tt-val { font-weight: 600; color: #0f172a; }
  `],
})
export class ApmComboChartComponent implements OnDestroy {
  // ----- inputs -----
  data       = input<ChartDataPoint[]>([]);
  barKey     = input<string>('');
  lineKey    = input<string>('');
  barLabel   = input<string>('Value');
  lineLabel  = input<string>('Count');
  leftAxisLabel  = input<string>('');
  rightAxisLabel = input<string>('');
  height     = input<number>(256);
  barColorFn = input<(v: number, item: ChartDataPoint) => string>(() => '#6e8d5b');
  xLabelFn   = input<(item: ChartDataPoint) => string>((item) => String(item['name'] ?? ''));
  xFullLabelFn = input<(item: ChartDataPoint) => string>((item) => String(item['name'] ?? ''));
  tooltipTpl = undefined as any; // host can override via ng-template (Phase B+)

  // ----- internal -----
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private svgWrapRef = viewChild<ElementRef<HTMLDivElement>>('svgWrap');
  private ro: ResizeObserver | undefined;
  private _containerWidth = signal(640);

  svgWidth  = computed(() => this._containerWidth());
  svgHeight = computed(() => this.height() - 36); // subtract legend

  readonly margins = { top: 16, right: 60, bottom: 60, left: 58 };

  plotWidth  = computed(() => Math.max(0, this.svgWidth() - this.margins.left - this.margins.right));
  plotHeight = computed(() => Math.max(0, this.svgHeight() - this.margins.top - this.margins.bottom));

  // Left Y domain (bars)
  private leftMax = computed(() => {
    const key = this.barKey();
    if (!key) return 1;
    return Math.max(...this.data().map(d => Number(d[key]) || 0), 1);
  });

  // Right Y domain (line)
  private rightMax = computed(() => {
    const key = this.lineKey();
    if (!key) return 1;
    return Math.max(...this.data().map(d => Number(d[key]) || 0), 1);
  });

  private scaleLeft  = computed(() => (v: number) => this.plotHeight() - (v / this.leftMax()) * this.plotHeight());
  private scaleRight = computed(() => (v: number) => this.plotHeight() - (v / this.rightMax()) * this.plotHeight());

  leftTicks = computed(() => {
    const steps = 5;
    const max = this.leftMax();
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = (max / steps) * i;
      const y = this.margins.top + this.scaleLeft()(value);
      return { value, y };
    }).reverse();
  });

  rightTicks = computed(() => {
    if (!this.lineKey()) return [];
    const steps = 5;
    const max = this.rightMax();
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = (max / steps) * i;
      const y = this.margins.top + this.scaleRight()(value);
      return { value, y };
    }).reverse();
  });

  bars = computed(() => {
    const items = this.data();
    const key = this.barKey();
    if (!items.length || !key) return [];
    const n = items.length;
    const barW = Math.max(4, Math.min(36, (this.plotWidth() / n) * 0.6));
    const step = this.plotWidth() / n;
    return items.map((item, index) => {
      const v = Number(item[key]) || 0;
      const h = Math.max(1, (v / this.leftMax()) * this.plotHeight());
      return {
        index,
        item,
        x: this.margins.left + step * index + (step - barW) / 2,
        y: this.margins.top + this.plotHeight() - h,
        w: barW,
        h,
        color: this.barColorFn()(v, item),
      };
    });
  });

  lineDots = computed(() => {
    const key = this.lineKey();
    if (!key) return [];
    const items = this.data();
    const n = items.length;
    const step = this.plotWidth() / n;
    return items.map((item, index) => {
      const v = Number(item[key]) || 0;
      return {
        index,
        item,
        cx: this.margins.left + step * index + step / 2,
        cy: this.margins.top + this.scaleRight()(v),
      };
    });
  });

  linePath = computed(() => {
    const dots = this.lineDots();
    if (!dots.length) return '';
    return dots.map((d, i) => `${i === 0 ? 'M' : ''}${d.cx},${d.cy}`).join(' L ');
  });

  barLegendColor = computed(() => this.barColorFn()(this.leftMax() / 2, {}));

  // ----- tooltip -----
  tooltipVisible = signal(false);
  tooltipX = signal(0);
  tooltipY = signal(0);
  tooltipItem = signal<ChartDataPoint | null>(null);

  showTooltip(event: MouseEvent, item: ChartDataPoint): void {
    this.tooltipItem.set(item);
    this.tooltipVisible.set(true);
    this.positionTooltip(event);
  }
  hideTooltip(): void { this.tooltipVisible.set(false); }
  positionTooltip(event: MouseEvent): void {
    const rect = (event.currentTarget as Element).closest('.apm-combo-chart')?.getBoundingClientRect();
    if (!rect) return;
    const ex = event.clientX - rect.left;
    const ey = event.clientY - rect.top;
    this.tooltipX.set(ex + 12);
    this.tooltipY.set(ey - 20);
  }

  // ----- formatters -----
  formatLeft(v: number): string  { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString(); }
  formatRight(v: number): string { return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString(); }

  // ----- ResizeObserver -----
  constructor() {
    effect(() => {
      const wrapEl = this.svgWrapRef()?.nativeElement;
      if (!wrapEl || !this.isBrowser) return;
      this.ro?.disconnect();
      this.ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width ?? 640;
        this._containerWidth.set(Math.max(200, w));
      });
      this.ro.observe(wrapEl);
      this._containerWidth.set(Math.max(200, wrapEl.clientWidth || 640));
    });
  }

  ngOnDestroy(): void { this.ro?.disconnect(); }
}
