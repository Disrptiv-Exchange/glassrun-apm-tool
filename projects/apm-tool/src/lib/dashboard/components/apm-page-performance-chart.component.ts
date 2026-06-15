/**
 * ApmPagePerformanceChartComponent
 * Ported from PagePerformanceChart.jsx.
 * Area chart (avgLoadTime) + detailed panel (Core Web Vitals multi-line + popularity list).
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, computed, signal, effect, OnDestroy,
} from '@angular/core';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { PagePerformanceStats, DateRange } from '../models/apm-dashboard.models';
import { ApmAreaChartComponent, ExtraLine } from '../charts/apm-area-chart.component';
import { ChartDataPoint } from '../charts/apm-combo-chart.component';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

@Component({
  selector: 'apm-page-performance-chart',
  standalone: true,
  imports: [ApmAreaChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Page Performance Analysis
        </h3>
        <p class="pd-card-desc">Load times, Core Web Vitals, and user engagement metrics</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (chartData().length === 0) {
          <div class="pd-empty">
            <svg class="pd-empty__icon" width="48" height="48" fill="none" viewBox="0 0 24 24">
              <path d="M12 17v.01M12 7v6m0 8a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="pd-empty__title">No data available</div>
            <div class="pd-empty__sub">No page performance data found for the selected range.</div>
          </div>
        } @else {
          <!-- Primary area chart -->
          <apm-area-chart
            [data]="chartData()"
            areaKey="avgLoadTime"
            areaLabel="Avg Load Time"
            areaColor="#26547c"
            leftAxisLabel="Load Time (ms)"
            [height]="264"
            [xLabelFn]="xLabelFn"
            [xFullLabelFn]="xFullLabelFn"
          />

          @if (detailed()) {
            <div class="pd-overview-grid" style="margin-top:24px">
              <!-- Core Web Vitals multi-line -->
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--pd-text);margin-bottom:12px;display:flex;align-items:center;gap:6px">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  Core Web Vitals
                </div>
                <apm-area-chart
                  [data]="chartData()"
                  areaKey="avgFcp"
                  areaLabel="FCP (ms)"
                  areaColor="#6e8d5b"
                  [extraLines]="cwvLines"
                  [showLegend]="true"
                  [height]="220"
                  [xLabelFn]="xLabelFn"
                  [xFullLabelFn]="xFullLabelFn"
                />
              </div>

              <!-- Page popularity -->
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--pd-text);margin-bottom:12px;display:flex;align-items:center;gap:6px">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Page Popularity
                </div>
                @for (page of top5(); track page['fullUrl']; let i = $index) {
                  <div class="pd-pop-row">
                    <div style="display:flex;align-items:center;gap:8px;min-width:0">
                      <div class="pd-pop-row__badge">{{ i + 1 }}</div>
                      <span class="pd-pop-row__name" [title]="page['fullUrl']">{{ xLabelFn(page) }}</span>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                      <div class="pd-pop-row__visits">{{ page['visitCount'] }} visits</div>
                      <div class="pd-pop-row__avg">{{ (+page['avgLoadTime'] / 1000).toFixed(1) }}s avg</div>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class ApmPagePerformanceChartComponent implements OnDestroy {
  // ---- inputs ----
  dateRange = input<DateRange>({ from: null, to: null });
  detailed  = input<boolean>(false);
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('Portal');

  // ---- deps ----
  private dataProvider = inject(ApmDashboardDataProvider);
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  // ---- state ----
  loading  = signal(true);
  rawData  = signal<PagePerformanceStats[]>([]);

  // ---- derived ----
  chartData = computed((): ChartDataPoint[] =>
    this.rawData().map(item => ({
      ...item,
      fullUrl: item.pageUrl,
      name: this.pageName(item.pageUrl),
      lcp: item.avgLcp,
      fcp: item.avgFcp,
      inp: item.avgInp,
    }))
  );

  top5 = computed(() =>
    [...this.chartData()].sort((a, b) => b['visitCount'] - a['visitCount']).slice(0, 5)
  );

  readonly cwvLines: ExtraLine[] = [
    { key: 'avgLcp', color: '#a78bfa', label: 'LCP (ms)' },
    { key: 'avgInp', color: '#26547c', label: 'INP (ms)' },
  ];

  readonly xLabelFn = (item: ChartDataPoint): string => {
    const url = String(item['fullUrl'] ?? '');
    const seg = (url.split('/').filter(Boolean).pop() ?? url.replace('/', '')) || 'Home';
    return seg.length > 10 ? seg.slice(0, 10) + '…' : seg;
  };
  readonly xFullLabelFn = (item: ChartDataPoint): string => String(item['fullUrl'] ?? '');

  private pageName(url: string): string {
    if (!url) return 'Unknown';
    return url.replace('/', '') || 'Home';
  }

  private buildFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = { limit: 8 };
    if (from && to) {
      f.startDate = toLocalISOString(from);
      f.endDate   = toLocalISOString(to);
    }
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
        return this.dataProvider.getPagePerformanceStats(this.buildFilter());
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d  => { this.rawData.set(d ?? []); this.loading.set(false); },
      error: () => { this.rawData.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source();
      this.trigger$.next();
    });
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
