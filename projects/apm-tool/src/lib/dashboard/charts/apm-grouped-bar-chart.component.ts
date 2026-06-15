/**
 * ApmGroupedBarChartComponent
 * Inline-SVG grouped bar chart supporting up to 4 series per category.
 * Used by: MobileTab (battery/storage/network breakdowns), AppsComparison, UX offline trend.
 *
 * Inputs:
 *   data        — array of objects with a 'name' key + series value keys
 *   series      — [{ key, color, label }]
 *   height      — px, default 240
 *   xLabelFn    — display label for x-tick
 *   yLabelFn    — display label for y-tick
 *   leftAxisLabel
 */
import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  ElementRef, viewChild, input, computed, effect, signal, OnDestroy, PLATFORM_ID, inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface GroupedBarSeries {
  key: string;
  color: string;
  label: string;
}

@Component({
  selector: 'apm-grouped-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="apm-gb-chart" [style.height.px]="height()">
      @if (rows().length === 0) {
        <div class="apm-gb-chart__empty">No data</div>
      } @else {
        <!-- Legend -->
        <div class="apm-gb-chart__legend">
          @for (s of series(); track s.key) {
            <span class="apm-gb-chart__legend-item">
              <span class="apm-gb-chart__legend-swatch" [style.background]="s.color"></span>
              {{ s.label }}
            </span>
          }
        </div>
        <div class="apm-gb-chart__svg-wrap" #svgWrap>
          <svg [attr.width]="svgWidth()" [attr.height]="svgHeight()" style="display:block;overflow:visible" aria-hidden="true">
            <!-- Grid -->
            @for (tick of yTicks(); track tick.value) {
              <line [attr.x1]="M.left" [attr.x2]="svgWidth()-M.right"
                [attr.y1]="tick.y" [attr.y2]="tick.y"
                stroke="#e5e7eb" stroke-dasharray="3 3" stroke-width="1"/>
            }
            <!-- Left axis -->
            <line [attr.x1]="M.left" [attr.x2]="M.left"
              [attr.y1]="M.top" [attr.y2]="svgHeight()-M.bottom"
              stroke="#e5e7eb" stroke-width="1"/>
            @for (tick of yTicks(); track tick.value) {
              <text [attr.x]="M.left-6" [attr.y]="tick.y"
                text-anchor="end" dominant-baseline="middle" font-size="11" fill="#64748b">
                {{ yLabelFn()(tick.value) }}
              </text>
            }
            @if (leftAxisLabel()) {
              <text [attr.x]="12" [attr.y]="M.top+plotH()/2"
                text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#64748b"
                [attr.transform]="'rotate(-90,12,'+(M.top+plotH()/2)+')'">
                {{ leftAxisLabel() }}
              </text>
            }
            <!-- Bars -->
            @for (grp of barGroups(); track grp.name) {
              @for (bar of grp.bars; track bar.seriesKey) {
                <rect
                  [attr.x]="bar.x" [attr.y]="bar.y"
                  [attr.width]="bar.w" [attr.height]="bar.h"
                  [attr.fill]="bar.color" rx="2" ry="2"
                  class="apm-gb-chart__bar"
                  (mouseenter)="showTip($event, grp.name, grp.data)"
                  (mouseleave)="hideTip()"
                />
              }
              <!-- X-tick -->
              <g [attr.transform]="'translate('+(grp.cx)+','+(svgHeight()-M.bottom+5)+')'">
                <text x="-5" y="10" text-anchor="end" font-size="11" fill="#64748b" transform="rotate(-35)">
                  {{ xLabelFn()(grp.name) }}
                </text>
              </g>
            }
          </svg>
        </div>
        @if (tipVisible()) {
          <div class="apm-gb-chart__tooltip" [style.left.px]="tipX()" [style.top.px]="tipY()">
            <div class="tt-title">{{ tipName() }}</div>
            @for (s of series(); track s.key) {
              <div class="tt-row">
                <span>{{ s.label }}</span>
                <span class="tt-val">{{ yLabelFn()(tipData()[s.key] ?? 0) }}</span>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .apm-gb-chart { position:relative;width:100%;display:flex;flex-direction:column; }
    .apm-gb-chart__empty { display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:13px; }
    .apm-gb-chart__legend { display:flex;gap:14px;margin-bottom:6px;font-size:12px;color:#64748b;padding-left:4px; }
    .apm-gb-chart__legend-item { display:inline-flex;align-items:center;gap:6px; }
    .apm-gb-chart__legend-swatch { width:12px;height:10px;border-radius:2px;display:inline-block; }
    .apm-gb-chart__svg-wrap { flex:1;min-height:0;overflow:visible; }
    .apm-gb-chart__bar { cursor:default;transition:opacity 0.1s; }
    .apm-gb-chart__bar:hover { opacity:0.8; }
    .apm-gb-chart__tooltip {
      position:absolute;z-index:100;background:#fff;border:1px solid #e5e7eb;
      border-radius:8px;padding:10px 12px;font-size:12px;
      box-shadow:0 4px 16px rgba(15,23,42,0.12);min-width:160px;
      pointer-events:none;white-space:nowrap;
    }
    .tt-title { font-weight:600;color:#0f172a;margin-bottom:4px; }
    .tt-row { display:flex;justify-content:space-between;gap:12px;color:#374151;line-height:1.6; }
    .tt-val { font-weight:600;color:#0f172a; }
  `],
})
export class ApmGroupedBarChartComponent implements OnDestroy {
  data          = input<Record<string, any>[]>([]);
  series        = input<GroupedBarSeries[]>([]);
  height        = input<number>(240);
  xLabelFn      = input<(name: string) => string>((n) => n);
  yLabelFn      = input<(v: number) => string>((v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : Math.round(v).toString());
  leftAxisLabel = input<string>('');

  readonly M = { top: 16, right: 16, bottom: 60, left: 54 };

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private svgWrapRef = viewChild<ElementRef<HTMLDivElement>>('svgWrap');
  private ro: ResizeObserver | undefined;
  private _cw = signal(640);

  svgWidth  = computed(() => this._cw());
  svgHeight = computed(() => this.height() - 28);
  plotW     = computed(() => Math.max(0, this.svgWidth() - this.M.left - this.M.right));
  plotH     = computed(() => Math.max(0, this.svgHeight() - this.M.top - this.M.bottom));

  rows = computed(() => this.data());

  private yMax = computed(() => {
    const keys = this.series().map(s => s.key);
    const vals = this.rows().flatMap(d => keys.map(k => Number(d[k]) || 0));
    return Math.max(...vals, 1);
  });

  yTicks = computed(() => {
    const steps = 5;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = (this.yMax() / steps) * i;
      const y = this.M.top + this.plotH() - (value / this.yMax()) * this.plotH();
      return { value, y };
    }).reverse();
  });

  barGroups = computed(() => {
    const rows = this.rows();
    const ser  = this.series();
    if (!rows.length || !ser.length) return [];
    const n = rows.length;
    const ns = ser.length;
    const grpW = this.plotW() / n;
    const totalPad = grpW * 0.2;
    const barW = Math.max(3, Math.min(28, (grpW - totalPad) / ns));
    const grpPad = (grpW - barW * ns) / 2;

    return rows.map((d, gi) => {
      const grpX = this.M.left + grpW * gi;
      const bars = ser.map((s, si) => {
        const v = Number(d[s.key]) || 0;
        const h = Math.max(1, (v / this.yMax()) * this.plotH());
        return {
          seriesKey: s.key,
          color: s.color,
          x: grpX + grpPad + si * barW,
          y: this.M.top + this.plotH() - h,
          w: barW,
          h,
        };
      });
      return { name: String(d['name'] ?? ''), data: d, cx: grpX + grpW / 2, bars };
    });
  });

  tipVisible = signal(false);
  tipX = signal(0);
  tipY = signal(0);
  tipName = signal('');
  tipData = signal<Record<string, any>>({});

  showTip(event: MouseEvent, name: string, data: Record<string, any>): void {
    this.tipName.set(name);
    this.tipData.set(data);
    this.tipVisible.set(true);
    const rect = (event.currentTarget as Element).closest('.apm-gb-chart')?.getBoundingClientRect();
    if (!rect) return;
    this.tipX.set(event.clientX - rect.left + 12);
    this.tipY.set(event.clientY - rect.top - 20);
  }
  hideTip(): void { this.tipVisible.set(false); }

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
