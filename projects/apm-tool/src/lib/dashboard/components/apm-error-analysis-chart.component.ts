/**
 * ApmErrorAnalysisChartComponent
 * Ported from ErrorAnalysisChart.jsx.
 *
 * Layout (full-width card):
 *   - Left: pie chart grouping errors by status code
 *   - Right: horizontal bar chart of top-8 error APIs
 *   - Bottom: scrollable "Error Summary" list of top-10 rows
 *
 * Inline SVG, OnPush, signal-based. Zero runtime deps.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID, ElementRef, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { ErrorAnalysis, DateRange } from '../models/apm-dashboard.models';
import { ApmPieChartComponent, PieSlice } from '../charts/apm-pie-chart.component';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

interface StatusGroup {
  statusCode: number;
  count: number;
  percentage: number;
  name: string;
  color: string;
}

interface TopApiBar {
  name: string;
  fullUrl: string;
  count: number;
  statusCode: number;
  color: string;
}

function statusColor(code: number): string {
  if (code >= 500) return '#ef476f';
  if (code >= 400) return '#8d99ae';
  return '#f4a261';
}

function statusDesc(code: number): string {
  const map: Record<number, string> = {
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 429: 'Too Many Requests', 500: 'Internal Server Error',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
  };
  return map[code] ?? 'Unknown Error';
}

@Component({
  selector: 'apm-error-analysis-chart',
  standalone: true,
  imports: [ApmPieChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Error Analysis Dashboard
        </h3>
        <p class="pd-card-desc">HTTP error distribution and affected APIs</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (rawData().length === 0) {
          <div class="pd-empty">
            <svg class="pd-empty__icon" width="48" height="48" fill="none" viewBox="0 0 24 24">
              <path d="M12 17v.01M12 7v6m0 8a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="pd-empty__title">No error data available</div>
            <div class="pd-empty__sub">No errors found for the selected range.</div>
          </div>
        } @else {
          <div class="pd-overview-grid">
            <!-- Pie: error distribution by status code -->
            <div>
              <div class="apm-ea__section-title">Error Distribution by Status Code</div>
              <div style="display:flex;justify-content:center">
                <apm-pie-chart
                  [data]="pieSlices()"
                  [size]="200"
                  [donut]="true"
                />
              </div>
            </div>

            <!-- Horizontal bar: top error APIs -->
            <div>
              <div class="apm-ea__section-title">Most Affected APIs</div>
              <div class="apm-ea__hbar-wrap" #hbarWrap>
                <svg [attr.width]="hbarW()" [attr.height]="hbarH()" style="display:block" aria-hidden="true">
                  @for (bar of topBars(); track bar.name; let i = $index) {
                    <!-- row bg -->
                    <rect
                      [attr.x]="hMargins.left"
                      [attr.y]="i * hRowH + hMargins.top"
                      [attr.width]="barWidth(bar)"
                      [attr.height]="hRowH - 6"
                      [attr.fill]="bar.color"
                      rx="3"
                      class="apm-ea__hbar"
                    >
                      <title>{{ bar.fullUrl }} – {{ bar.count }} errors</title>
                    </rect>
                    <!-- label left -->
                    <text
                      [attr.x]="hMargins.left - 6"
                      [attr.y]="i * hRowH + hMargins.top + (hRowH - 6) / 2"
                      text-anchor="end"
                      dominant-baseline="middle"
                      font-size="11"
                      fill="#64748b"
                    >{{ bar.name }}</text>
                    <!-- count right -->
                    <text
                      [attr.x]="hMargins.left + barWidth(bar) + 6"
                      [attr.y]="i * hRowH + hMargins.top + (hRowH - 6) / 2"
                      text-anchor="start"
                      dominant-baseline="middle"
                      font-size="11"
                      fill="#374151"
                      font-weight="600"
                    >{{ bar.count }}</text>
                  }
                </svg>
              </div>
            </div>
          </div>

          <!-- Error summary list -->
          <div style="margin-top:24px">
            <div class="apm-ea__section-title">Error Summary</div>
            @for (item of summaryRows(); track $index) {
              <div class="apm-ea__summary-row">
                <div class="apm-ea__summary-left">
                  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
                    [style.color]="statusColor(item.statusCode)">
                    @if (item.statusCode >= 500) {
                      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    } @else if (item.statusCode >= 400) {
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    } @else {
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    }
                  </svg>
                  <span class="apm-ea__status-badge"
                    [style.border-color]="statusColor(item.statusCode)"
                    [style.color]="statusColor(item.statusCode)">
                    {{ item.statusCode }}
                  </span>
                  <div>
                    <div class="apm-ea__api-name">{{ apiName(item.apiUrl) }}</div>
                    <div class="apm-ea__api-url">{{ item.apiUrl }}</div>
                  </div>
                </div>
                <div class="apm-ea__summary-right">
                  <div class="apm-ea__err-count">{{ item.count }} errors</div>
                  <div class="apm-ea__err-pct">{{ item.percentage?.toFixed(1) ?? 'N/A' }}% of total</div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .apm-ea__section-title {
      font-size: 13px; font-weight: 600; color: var(--pd-text); margin-bottom: 12px;
    }
    .apm-ea__hbar-wrap { width: 100%; overflow: visible; }
    .apm-ea__hbar { cursor: default; transition: opacity 0.1s; }
    .apm-ea__hbar:hover { opacity: 0.82; }
    .apm-ea__summary-row {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: 12px; border-radius: 8px;
      background: var(--pd-surface-muted); border: 1px solid var(--pd-border);
      margin-bottom: 8px; gap: 12px;
    }
    .apm-ea__summary-left { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
    .apm-ea__status-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;
      border: 1.5px solid; white-space: nowrap; flex-shrink: 0; align-self: center;
    }
    .apm-ea__api-name { font-size: 13px; font-weight: 500; color: var(--pd-text); }
    .apm-ea__api-url  { font-size: 11px; color: var(--pd-text-muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .apm-ea__summary-right { text-align: right; flex-shrink: 0; }
    .apm-ea__err-count { font-size: 13px; font-weight: 600; color: var(--pd-text); }
    .apm-ea__err-pct   { font-size: 11px; color: var(--pd-text-muted); }
  `],
})
export class ApmErrorAnalysisChartComponent implements OnDestroy {
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
  loading = signal(true);
  rawData = signal<ErrorAnalysis[]>([]);

  // horizontal bar chart layout
  private hbarWrapRef = viewChild<ElementRef<HTMLDivElement>>('hbarWrap');
  private ro: ResizeObserver | undefined;
  private _hbarContainerW = signal(400);
  readonly hMargins = { top: 4, right: 50, bottom: 4, left: 110 };
  readonly hRowH    = 30;

  hbarW = computed(() => this._hbarContainerW());
  hbarH = computed(() => {
    const n = this.topBars().length;
    return this.hMargins.top + n * this.hRowH + this.hMargins.bottom;
  });

  private hPlotW = computed(() =>
    Math.max(60, this.hbarW() - this.hMargins.left - this.hMargins.right)
  );
  private maxBarCount = computed(() =>
    Math.max(...this.topBars().map(b => b.count), 1)
  );

  barWidth(bar: TopApiBar): number {
    return Math.max(2, (bar.count / this.maxBarCount()) * this.hPlotW());
  }

  // derived
  statusGroups = computed((): StatusGroup[] => {
    const groups: StatusGroup[] = [];
    for (const item of this.rawData()) {
      const existing = groups.find(g => g.statusCode === item.statusCode);
      if (existing) {
        existing.count      += item.count;
        existing.percentage += item.percentage;
      } else {
        groups.push({
          statusCode:  item.statusCode,
          count:       item.count,
          percentage:  item.percentage,
          name:        `${item.statusCode} – ${statusDesc(item.statusCode)}`,
          color:       statusColor(item.statusCode),
        });
      }
    }
    return groups;
  });

  pieSlices = computed((): PieSlice[] =>
    this.statusGroups().map(g => ({
      label: g.name,
      value: g.count,
      color: g.color,
    }))
  );

  topBars = computed((): TopApiBar[] =>
    [...this.rawData()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(item => ({
        name:       this.apiName(item.apiUrl),
        fullUrl:    item.apiUrl,
        count:      Number(item.count),
        statusCode: item.statusCode,
        color:      statusColor(item.statusCode),
      }))
  );

  summaryRows = computed(() => this.rawData().slice(0, 10));

  // helpers
  apiName(url: string): string {
    if (!url) return 'Unknown';
    const parts = url.split('/').filter(Boolean);
    const seg   = parts[parts.length - 1] || url;
    return seg.length > 18 ? seg.slice(0, 16) + '…' : seg;
  }

  statusColor(code: number): string { return statusColor(code); }

  private buildFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = {};
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
        return this.dataProvider.getErrorAnalysis(this.buildFilter());
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: data => { this.rawData.set(data ?? []); this.loading.set(false); },
      error: ()  => { this.rawData.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source();
      this.trigger$.next();
    });

    // ResizeObserver for hbar
    if (this.isBrowser) {
      effect(() => {
        const el = this.hbarWrapRef()?.nativeElement;
        if (!el) return;
        this.ro?.disconnect();
        this.ro = new ResizeObserver(entries => {
          const w = entries[0]?.contentRect.width ?? 400;
          this._hbarContainerW.set(Math.max(200, w));
        });
        this.ro.observe(el);
        this._hbarContainerW.set(Math.max(200, el.clientWidth || 400));
      });
    }
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); this.ro?.disconnect(); }
}
