/**
 * ApmLineChartComponent
 * Inline-SVG single-metric line/area chart over timestamps.
 * Used by: TimeSeriesChart (Trends tab), Apdex trend, Bounce Rate trend, Cold Start trend.
 *
 * Key difference from ApmAreaChartComponent:
 *  - X data is always a 'timestamp'|'date'|'time' string, parsed to Date for display
 *  - Single area fill + line only (no multi-series overlay; that's handled by ApmGroupedBarChart)
 *  - Shows min / avg / peak footer row
 *  - Accepts a custom valueFormatFn for the y-axis and tooltip
 *
 * Inputs:
 *   data          — ChartDataPoint[] with a 'value' numeric key and a timestamp x key
 *   xKey          — key used as the x-axis (default 'timestamp')
 *   valueKey      — key used as the y-axis (default 'value')
 *   color         — line/area color
 *   height        — px, default 256
 *   valueFormatFn — number → string for y-axis + tooltip
 *   xFormatFn     — string → string for x-tick display
 *   xFullFormatFn — string → string for tooltip full label
 *   showFooter    — show min/avg/peak footer (default false)
 *   yMin          — force y-axis minimum (e.g. 0 for apdex 0..1)
 *   yMax          — force y-axis maximum (e.g. 100 for bounce rate)
 *   leftAxisLabel
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  ElementRef, viewChild, input, computed, effect, signal, OnDestroy, PLATFORM_ID, inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface LineChartPoint {
  [key: string]: any;
}

@Component({
  selector: 'apm-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="apm-lc" [style.height.px]="height()">
      @if (pts().length === 0) {
        <div class="apm-lc__empty">No data</div>
      } @else {
        <div class="apm-lc__svg-wrap" #svgWrap>
          <svg [attr.width]="svgWidth()" [attr.height]="svgHeight()" style="display:block;overflow:visible" aria-hidden="true">
            <defs>
              <linearGradient [id]="gradId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" [attr.stop-color]="color()" stop-opacity="0.18"/>
                <stop offset="100%" [attr.stop-color]="color()" stop-opacity="0.02"/>
              </linearGradient>
            </defs>
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
                {{ valueFormatFn()(tick.value) }}
              </text>
            }
            @if (leftAxisLabel()) {
              <text [attr.x]="12" [attr.y]="M.top+plotH()/2"
                text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#64748b"
                [attr.transform]="'rotate(-90,12,'+(M.top+plotH()/2)+')'">
                {{ leftAxisLabel() }}
              </text>
            }
            <!-- Area fill -->
            @if (areaPath()) {
              <path [attr.d]="areaPath()" [attr.fill]="'url(#'+gradId+')'"/>
              <polyline [attr.points]="linePath()" fill="none"
                [attr.stroke]="color()" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"/>
            }
            <!-- Dots + x ticks — only show every Nth to avoid overlap -->
            @for (dot of visibleDots(); track dot.index) {
              <circle [attr.cx]="dot.cx" [attr.cy]="dot.cy"
                r="4" [attr.fill]="color()" stroke="#fff" stroke-width="2"
                class="apm-lc__dot"
                (mouseenter)="showTip($event, dot)"
                (mouseleave)="hideTip()"/>
              <g [attr.transform]="'translate('+dot.cx+','+(svgHeight()-M.bottom+5)+')'">
                <text x="-5" y="10" text-anchor="end" font-size="10" fill="#64748b" transform="rotate(-35)">
                  {{ xFormatFn()(dot.x) }}
                </text>
              </g>
            }
          </svg>
        </div>

        @if (tipVisible()) {
          <div class="apm-lc__tooltip" [style.left.px]="tipX()" [style.top.px]="tipY()">
            <div class="tt-title">{{ xFullFormatFn()(tipDot()!.x) }}</div>
            <div class="tt-row">
              <span>Value</span>
              <span class="tt-val">{{ valueFormatFn()(tipDot()!.v) }}</span>
            </div>
          </div>
        }

        @if (showFooter() && footerStats()) {
          <div class="apm-lc__footer">
            <div class="apm-lc__footer-cell">
              <span class="apm-lc__footer-label">Current</span>
              <span class="apm-lc__footer-val">{{ valueFormatFn()(footerStats()!.current) }}</span>
            </div>
            <div class="apm-lc__footer-cell">
              <span class="apm-lc__footer-label">Avg</span>
              <span class="apm-lc__footer-val">{{ valueFormatFn()(footerStats()!.avg) }}</span>
            </div>
            <div class="apm-lc__footer-cell">
              <span class="apm-lc__footer-label">Peak</span>
              <span class="apm-lc__footer-val">{{ valueFormatFn()(footerStats()!.peak) }}</span>
            </div>
          </div>
        }

        <!-- Trend badge -->
        @if (trendPct() !== null) {
          <div class="apm-lc__trend" [style.color]="trendColor()">
            @if (trendPct()! > 5) {
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                <polyline points="17 6 23 6 23 12"/>
              </svg>
            } @else if (trendPct()! < -5) {
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
                <polyline points="17 18 23 18 23 12"/>
              </svg>
            } @else {
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            }
            {{ trendPct()! > 0 ? '+' : '' }}{{ trendPct()!.toFixed(1) }}%
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .apm-lc { position:relative;width:100%;display:flex;flex-direction:column; }
    .apm-lc__empty { display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:13px; }
    .apm-lc__svg-wrap { flex:1;min-height:0;overflow:visible; }
    .apm-lc__dot { cursor:default; }
    .apm-lc__tooltip {
      position:absolute;z-index:100;background:#fff;border:1px solid #e5e7eb;
      border-radius:8px;padding:10px 12px;font-size:12px;
      box-shadow:0 4px 16px rgba(15,23,42,0.12);min-width:160px;
      pointer-events:none;white-space:nowrap;
    }
    .tt-title { font-weight:600;color:#0f172a;margin-bottom:4px; }
    .tt-row { display:flex;justify-content:space-between;gap:12px;color:#374151;line-height:1.6; }
    .tt-val { font-weight:600;color:#0f172a; }
    .apm-lc__footer { display:flex;gap:0;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:10px; }
    .apm-lc__footer-cell { flex:1;text-align:center; }
    .apm-lc__footer-label { display:block;font-size:11px;color:#64748b;margin-bottom:2px; }
    .apm-lc__footer-val { display:block;font-size:15px;font-weight:600;color:#0f172a; }
    .apm-lc__trend {
      position:absolute;top:4px;right:4px;
      display:inline-flex;align-items:center;gap:3px;
      font-size:12px;font-weight:600;
    }
  `],
})
export class ApmLineChartComponent implements OnDestroy {
  data          = input<LineChartPoint[]>([]);
  xKey          = input<string>('timestamp');
  valueKey      = input<string>('value');
  color         = input<string>('#26547c');
  height        = input<number>(256);
  valueFormatFn = input<(v: number) => string>((v) => v >= 1000 ? `${(v/1000).toFixed(1)}s` : `${Math.round(v)}ms`);
  xFormatFn     = input<(x: string) => string>((x) => {
    const d = new Date(x);
    return isNaN(d.getTime()) ? x.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  xFullFormatFn = input<(x: string) => string>((x) => {
    const d = new Date(x);
    return isNaN(d.getTime()) ? x : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  });
  showFooter    = input<boolean>(false);
  yMinOverride  = input<number | null>(null);
  yMaxOverride  = input<number | null>(null);
  leftAxisLabel = input<string>('');

  readonly gradId = `apm-lc-grad-${Math.random().toString(36).slice(2)}`;
  readonly M = { top: 16, right: 16, bottom: 58, left: 58 };

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private svgWrapRef = viewChild<ElementRef<HTMLDivElement>>('svgWrap');
  private ro: ResizeObserver | undefined;
  private _cw = signal(640);

  svgWidth  = computed(() => this._cw());
  svgHeight = computed(() => this.height() - (this.showFooter() ? 52 : 0));
  plotW     = computed(() => Math.max(0, this.svgWidth() - this.M.left - this.M.right));
  plotH     = computed(() => Math.max(0, this.svgHeight() - this.M.top - this.M.bottom));

  pts = computed(() => {
    const xk = this.xKey();
    const vk = this.valueKey();
    return this.data().map(d => ({ x: String(d[xk] ?? ''), v: Number(d[vk]) || 0, raw: d }));
  });

  private effectiveYMax = computed(() => {
    if (this.yMaxOverride() !== null) return this.yMaxOverride()!;
    return Math.max(...this.pts().map(p => p.v), 1);
  });
  private effectiveYMin = computed(() => {
    if (this.yMinOverride() !== null) return this.yMinOverride()!;
    return 0;
  });

  yTicks = computed(() => {
    const steps = 5;
    const min = this.effectiveYMin();
    const max = this.effectiveYMax();
    const range = max - min;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = min + (range / steps) * i;
      const y = this.M.top + this.plotH() - ((value - min) / range) * this.plotH();
      return { value, y };
    }).reverse();
  });

  private xFor = computed(() => {
    const n = this.pts().length;
    const step = n > 1 ? this.plotW() / (n - 1) : this.plotW() / 2;
    return (i: number) => this.M.left + (n > 1 ? step * i : this.plotW() / 2);
  });

  private yFor = (v: number) => {
    const min = this.effectiveYMin();
    const max = this.effectiveYMax();
    return this.M.top + this.plotH() - ((v - min) / (max - min)) * this.plotH();
  };

  private allDots = computed(() =>
    this.pts().map((p, i) => ({ index: i, x: p.x, v: p.v, cx: this.xFor()(i), cy: this.yFor(p.v) }))
  );

  // Thin visible dots to avoid overcrowding — show at most ~20 labels
  visibleDots = computed(() => {
    const dots = this.allDots();
    const step = Math.max(1, Math.ceil(dots.length / 20));
    return dots.filter((_, i) => i % step === 0 || i === dots.length - 1);
  });

  linePath = computed(() =>
    this.allDots().map((d, i) => `${i === 0 ? '' : 'L '}${d.cx},${d.cy}`).join(' ').trim()
  );

  areaPath = computed(() => {
    const dots = this.allDots();
    if (!dots.length) return '';
    const base = this.M.top + this.plotH();
    const top = dots.map((d, i) => `${i === 0 ? 'M' : 'L'} ${d.cx},${d.cy}`).join(' ');
    return `${top} L ${dots[dots.length - 1].cx},${base} L ${dots[0].cx},${base} Z`;
  });

  trendPct = computed((): number | null => {
    const pts = this.pts();
    if (pts.length < 2) return null;
    const first = pts[0].v;
    const last = pts[pts.length - 1].v;
    if (first === 0) return null;
    return ((last - first) / first) * 100;
  });

  trendColor = computed(() => {
    const t = this.trendPct();
    if (t === null) return '#64748b';
    if (t > 5) return '#ef4444';
    if (t < -5) return '#10b981';
    return '#f59e0b';
  });

  footerStats = computed(() => {
    const pts = this.pts();
    if (!pts.length) return null;
    const vals = pts.map(p => p.v);
    return {
      current: vals[vals.length - 1],
      avg: vals.reduce((s, v) => s + v, 0) / vals.length,
      peak: Math.max(...vals),
    };
  });

  tipVisible = signal(false);
  tipX = signal(0);
  tipY = signal(0);
  tipDot = signal<{ x: string; v: number } | null>(null);

  showTip(event: MouseEvent, dot: { x: string; v: number; cx: number; cy: number }): void {
    this.tipDot.set(dot);
    this.tipVisible.set(true);
    const rect = (event.currentTarget as Element).closest('.apm-lc')?.getBoundingClientRect();
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
