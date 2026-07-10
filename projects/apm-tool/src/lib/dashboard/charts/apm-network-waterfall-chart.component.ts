/**
 * ApmNetworkWaterfallChartComponent
 * Ported from NetworkWaterfallChart.jsx (GR-9408).
 *
 * Stacked horizontal bar chart showing per-API network timing:
 * DNS / TCP / SSL / TTFB / Download.
 *
 * Uses the same getApiPerformanceStats() provider method — only rows
 * that carry at least one non-null network timing field are rendered.
 *
 * Inline SVG, OnPush, signal-based, ResizeObserver. Zero deps.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID, ElementRef, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { DateRange } from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

// Timing segment definition
interface Segment { key: string; color: string; label: string; }

const SEGMENTS: Segment[] = [
  { key: 'DNS',      color: '#60a5fa', label: 'DNS'      },
  { key: 'TCP',      color: '#a78bfa', label: 'TCP'      },
  { key: 'SSL',      color: '#f472b6', label: 'SSL'      },
  { key: 'TTFB',     color: '#fbbf24', label: 'TTFB'     },
  { key: 'Download', color: '#34d399', label: 'Download' },
];

interface WaterfallRow {
  api: string;
  fullUrl: string;
  DNS: number;
  TCP: number;
  SSL: number;
  TTFB: number;
  Download: number;
  total: number;
}

@Component({
  selector: 'apm-network-waterfall-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
          </svg>
          Network Timing Breakdown
        </h3>
        <p class="pd-card-desc">Where API time is spent: DNS / TCP / SSL / TTFB / Download (top 10 APIs)</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (rows().length === 0) {
          <div class="pd-empty">
            <svg class="pd-empty__icon" width="48" height="48" fill="none" viewBox="0 0 24 24">
              <path d="M12 17v.01M12 7v6m0 8a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="pd-empty__title">No network timing data</div>
            <div class="pd-empty__sub">No cross-origin-safe timing data available for the selected range.</div>
          </div>
        } @else {
          <!-- Legend -->
          <div class="apm-wf__legend">
            @for (seg of segments; track seg.key) {
              <span class="apm-wf__legend-item">
                <span class="apm-wf__legend-dot" [style.background]="seg.color"></span>
                {{ seg.label }}
              </span>
            }
          </div>

          <!-- SVG chart -->
          <div class="apm-wf__svg-wrap" #svgWrap>
            <svg
              [attr.width]="svgW()"
              [attr.height]="svgH()"
              style="display:block;overflow:visible"
              aria-hidden="true"
            >
              <!-- Y-axis labels (api names) -->
              @for (row of rows(); track row.api; let i = $index) {
                <text
                  [attr.x]="margins.left - 8"
                  [attr.y]="barY(i) + barH() / 2"
                  text-anchor="end"
                  dominant-baseline="middle"
                  font-size="11"
                  fill="#64748b"
                >{{ row.api }}</text>
              }

              <!-- X-axis ticks -->
              @for (tick of xTicks(); track tick.value) {
                <line
                  [attr.x1]="tick.x"
                  [attr.x2]="tick.x"
                  [attr.y1]="margins.top"
                  [attr.y2]="svgH() - margins.bottom"
                  stroke="#e5e7eb"
                  stroke-dasharray="3 3"
                  stroke-width="1"
                />
                <text
                  [attr.x]="tick.x"
                  [attr.y]="svgH() - margins.bottom + 14"
                  text-anchor="middle"
                  font-size="10"
                  fill="#64748b"
                >{{ tick.label }}</text>
              }

              <!-- Stacked bars -->
              @for (row of rows(); track row.api; let i = $index) {
                @for (seg of segments; track seg.key) {
                  @if (getSegVal(row, seg.key) > 0) {
                    <rect
                      [attr.x]="segX(row, seg.key, i)"
                      [attr.y]="barY(i)"
                      [attr.width]="segW(row, seg.key)"
                      [attr.height]="barH() - 4"
                      [attr.fill]="seg.color"
                      rx="2" ry="2"
                      class="apm-wf__bar"
                      (mouseenter)="showTip($event, row, seg)"
                      (mouseleave)="hideTip()"
                    >
                      <title>{{ row.api }} – {{ seg.label }}: {{ getSegVal(row, seg.key) }}ms</title>
                    </rect>
                  }
                }
              }
            </svg>
          </div>

          <!-- Tooltip -->
          @if (tipVisible()) {
            <div class="apm-wf__tooltip" [style.left.px]="tipX()" [style.top.px]="tipY()">
              <div class="apm-wf__tt-title">{{ tipRow()?.fullUrl }}</div>
              @if (tipSeg()) {
                <div class="apm-wf__tt-row">
                  <span [style.color]="tipSeg()!.color">{{ tipSeg()!.label }}</span>
                  <span class="apm-wf__tt-val">{{ getSegVal(tipRow()!, tipSeg()!.key) }}ms</span>
                </div>
              }
              <div class="apm-wf__tt-row">
                <span>Total</span>
                <span class="apm-wf__tt-val">{{ tipRow()?.total }}ms</span>
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .apm-wf__legend {
      display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;
      font-size: 12px; color: #64748b;
    }
    .apm-wf__legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .apm-wf__legend-dot  { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .apm-wf__svg-wrap    { width: 100%; overflow: visible; }
    .apm-wf__bar { cursor: default; transition: opacity 0.1s; }
    .apm-wf__bar:hover { opacity: 0.82; }
    .apm-wf__tooltip {
      position: absolute; z-index: 100;
      background: #fff; border: 1px solid #e5e7eb;
      border-radius: 8px; padding: 10px 12px;
      font-size: 12px; box-shadow: 0 4px 16px rgba(15,23,42,0.12);
      min-width: 180px; pointer-events: none; white-space: nowrap;
    }
    .apm-wf__tt-title {
      font-weight: 600; font-size: 11px; color: #0f172a;
      margin-bottom: 6px; white-space: normal; word-break: break-all;
    }
    .apm-wf__tt-row {
      display: flex; justify-content: space-between; gap: 12px;
      line-height: 1.7; color: #374151;
    }
    .apm-wf__tt-val { font-weight: 600; color: #0f172a; }
  `],
})
export class ApmNetworkWaterfallChartComponent implements OnDestroy {
  // inputs
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('Portal');

  // deps
  private dataProvider = inject(ApmDashboardDataProvider);
  private isBrowser    = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$     = new Subject<void>();
  private trigger$     = new Subject<void>();

  // state
  loading    = signal(true);
  rawRows    = signal<WaterfallRow[]>([]);

  // tooltip state
  tipVisible = signal(false);
  tipX       = signal(0);
  tipY       = signal(0);
  tipRow     = signal<WaterfallRow | null>(null);
  tipSeg     = signal<Segment | null>(null);

  // layout
  private svgWrapRef   = viewChild<ElementRef<HTMLDivElement>>('svgWrap');
  private ro: ResizeObserver | undefined;
  private _w           = signal(640);

  readonly segments = SEGMENTS;
  readonly margins  = { top: 8, right: 20, bottom: 28, left: 180 };
  readonly rowH     = 32;

  rows = computed(() => this.rawRows());

  svgW = computed(() => this._w());
  svgH = computed(() => {
    const n = this.rows().length;
    return this.margins.top + n * this.rowH + this.margins.bottom + 8;
  });

  private plotW = computed(() => Math.max(100, this.svgW() - this.margins.left - this.margins.right));

  private maxTotal = computed(() =>
    Math.max(...this.rows().map(r => r.total), 1)
  );

  // X ticks
  xTicks = computed(() => {
    const steps = 5;
    const max = this.maxTotal();
    const pw  = this.plotW();
    return Array.from({ length: steps + 1 }, (_, i) => {
      const value = Math.round((max / steps) * i);
      const x     = this.margins.left + (value / max) * pw;
      const label = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
      return { value, x, label };
    });
  });

  barH() { return this.rowH; }
  barY(i: number) { return this.margins.top + i * this.rowH; }

  getSegVal(row: WaterfallRow, key: string): number {
    return (row as any)[key] ?? 0;
  }

  /** Cumulative x offset for a stacked segment. */
  segX(row: WaterfallRow, key: string, _i: number): number {
    const pw    = this.plotW();
    const max   = this.maxTotal();
    let offset  = 0;
    for (const seg of SEGMENTS) {
      if (seg.key === key) break;
      offset += (row as any)[seg.key] ?? 0;
    }
    return this.margins.left + (offset / max) * pw;
  }

  segW(row: WaterfallRow, key: string): number {
    const pw  = this.plotW();
    const max = this.maxTotal();
    const v   = (row as any)[key] ?? 0;
    return Math.max(1, (v / max) * pw);
  }

  showTip(event: MouseEvent, row: WaterfallRow, seg: Segment): void {
    const rect = (event.currentTarget as Element).closest('.pd-card-body')?.getBoundingClientRect();
    const el   = (event.currentTarget as Element).closest('.pd-card')?.getBoundingClientRect();
    if (!el) return;
    this.tipRow.set(row);
    this.tipSeg.set(seg);
    this.tipX.set(event.clientX - el.left + 12);
    this.tipY.set(event.clientY - el.top - 20);
    this.tipVisible.set(true);
  }
  hideTip(): void { this.tipVisible.set(false); }

  private buildFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = { limit: 10 };
    if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
    if (this.roleId() && this.roleId() !== 'all') f.roleId = this.roleId();
    if (this.userId() && this.userId() !== 'all') f.userId = this.userId();
    if (this.pageUrl() && this.pageUrl() !== 'all') f.pageUrl = this.pageUrl();
    if (this.source()) f.source = this.source();
    return f;
  }

  constructor() {
    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.loading.set(true);
        return this.dataProvider.getApiPerformanceStats(this.buildFilter());
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: data => {
        const filtered = (data ?? [])
          .filter(r => r.avgDnsMs != null || r.avgTcpMs != null || r.avgTtfbMs != null)
          .slice(0, 10)
          .map(r => ({
            api: (r.apiUrl || '').split('/').slice(-2).join('/') || 'unknown',
            fullUrl: r.apiUrl,
            DNS:      Math.max(0, Math.round(r.avgDnsMs ?? 0)),
            TCP:      Math.max(0, Math.round(r.avgTcpMs ?? 0)),
            SSL:      Math.max(0, Math.round(r.avgSslMs ?? 0)),
            TTFB:     Math.max(0, Math.round(r.avgTtfbMs ?? 0)),
            Download: Math.max(0, Math.round(r.avgResponseDownloadMs ?? 0)),
            total:    Math.round((r.avgDnsMs ?? 0) + (r.avgTcpMs ?? 0) + (r.avgSslMs ?? 0) + (r.avgTtfbMs ?? 0) + (r.avgResponseDownloadMs ?? 0)),
          }));
        this.rawRows.set(filtered);
        this.loading.set(false);
      },
      error: () => { this.rawRows.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source();
      this.trigger$.next();
    });

    // ResizeObserver
    if (this.isBrowser) {
      effect(() => {
        const el = this.svgWrapRef()?.nativeElement;
        if (!el) return;
        this.ro?.disconnect();
        this.ro = new ResizeObserver(entries => {
          const w = entries[0]?.contentRect.width ?? 640;
          this._w.set(Math.max(300, w));
        });
        this.ro.observe(el);
        this._w.set(Math.max(300, el.clientWidth || 640));
      });
    }
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); this.ro?.disconnect(); }
}
