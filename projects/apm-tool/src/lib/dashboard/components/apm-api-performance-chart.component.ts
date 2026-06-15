/**
 * ApmApiPerformanceChartComponent
 * Ported from ApiPerformanceChart.jsx.
 * Combo chart (bars=avgDuration, line=callCount) + detailed panel (pie + summary).
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, computed, signal, effect, OnDestroy,
} from '@angular/core';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { ApiPerformanceStats, DateRange } from '../models/apm-dashboard.models';
import { ApmComboChartComponent, ChartDataPoint } from '../charts/apm-combo-chart.component';
import { ApmPieChartComponent, PieSlice } from '../charts/apm-pie-chart.component';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

@Component({
  selector: 'apm-api-performance-chart',
  standalone: true,
  imports: [ApmComboChartComponent, ApmPieChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          API Performance Analysis
        </h3>
        <p class="pd-card-desc">Average response times and call volumes for top APIs</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (mainData().length === 0) {
          <div class="pd-empty">
            <svg class="pd-empty__icon" width="48" height="48" fill="none" viewBox="0 0 24 24">
              <path d="M12 17v.01M12 7v6m0 8a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="pd-empty__title">No data available</div>
            <div class="pd-empty__sub">No API performance data found for the selected range.</div>
          </div>
        } @else {
          <apm-combo-chart
            [data]="chartData()"
            barKey="avgDuration"
            lineKey="callCount"
            barLabel="Avg Response Time"
            lineLabel="API Call Count"
            leftAxisLabel="Response Time (ms)"
            rightAxisLabel="API Calls"
            [height]="264"
            [barColorFn]="barColorFn"
            [xLabelFn]="xLabelFn"
            [xFullLabelFn]="xFullLabelFn"
          />

          @if (detailed()) {
            <div class="pd-overview-grid" style="margin-top:24px">
              <!-- Error distribution pie -->
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--pd-text);margin-bottom:12px">
                  Error Rate Distribution
                </div>
                @if (errorPieSlices().length === 0) {
                  <div class="pd-empty" style="height:192px">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6e8d5b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M7 10v12"/><path d="M19 10v6a2 2 0 0 1-2 2H7"/>
                      <path d="M7 22h10a2 2 0 0 0 2-2v-6"/>
                      <path d="M14 10V5a3 3 0 0 0-6 0v5"/>
                      <path d="M5 15h14"/>
                    </svg>
                    <span style="color:#047857;font-size:14px;font-weight:500">No API errors in this period</span>
                  </div>
                } @else {
                  <div style="display:flex;justify-content:center">
                    <apm-pie-chart [data]="errorPieSlices()" [size]="160" [donut]="true" />
                  </div>
                }
              </div>

              <!-- Performance summary top-5 -->
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--pd-text);margin-bottom:12px">
                  Performance Summary
                </div>
                @for (api of top5(); track api.name) {
                  <div class="pd-perf-row">
                    <div class="pd-perf-row__left">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" [innerHTML]="trendIcon(api['trend'])"></svg>
                      <span class="pd-perf-row__name">{{ api.name }}</span>
                    </div>
                    <div class="pd-perf-row__right">
                      <span class="pd-perf-row__dur">{{ api['avgDuration'] ? api['avgDuration'].toFixed(0) + ' ms' : '—' }}</span>
                      @if (api['previousAvgDuration'] != null) {
                        <span class="pd-perf-row__prev">({{ api['previousAvgDuration'].toFixed(0) }} ms)</span>
                      }
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
export class ApmApiPerformanceChartComponent implements OnDestroy {
  // ---- inputs ----
  dateRange = input<DateRange>({ from: null, to: null });
  detailed  = input<boolean>(false);
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('Portal');
  limit     = input<number>(10);

  // ---- deps ----
  private dataProvider = inject(ApmDashboardDataProvider);
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  // ---- state ----
  loading  = signal(true);
  mainData = signal<ApiPerformanceStats[]>([]);
  errorData = signal<ApiPerformanceStats[]>([]);

  // ---- derived ----
  chartData = computed((): ChartDataPoint[] =>
    this.mainData().map(item => ({
      ...item,
      name: this.lastSegment(item.apiUrl),
      fullUrl: item.apiUrl,
      callCount: typeof item.callCount === 'number' ? item.callCount : Number(item.callCount) || 0,
    }))
  );

  errorPieSlices = computed((): PieSlice[] => {
    const errors = this.errorData().filter(e => e.errorCount > 0);
    const total = errors.reduce((s, e) => s + e.errorCount, 0);
    if (total === 0) return [];
    return errors.slice(0, 8).map(e => ({
      label: this.lastSegment(e.apiUrl),
      value: e.errorCount,
      color: '#ef476f',
    }));
  });

  top5 = computed(() =>
    [...this.chartData()].sort((a, b) => a['avgDuration'] - b['avgDuration']).slice(0, 5)
  );

  // ---- chart fn inputs ----
  readonly barColorFn = (v: number, _item: ChartDataPoint) => {
    if (v < 500) return '#6e8d5b';
    if (v < 1000) return '#ffd166';
    return '#ef476f';
  };
  readonly xLabelFn = (item: ChartDataPoint) => {
    const seg = this.lastSegment(String(item['fullUrl'] ?? ''));
    return seg.length > 12 ? seg.slice(0, 10) + '…' : seg;
  };
  readonly xFullLabelFn = (item: ChartDataPoint) => String(item['fullUrl'] ?? item['name'] ?? '');

  trendIcon(trend: string): string {
    if (trend === 'up')      return '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>';
    if (trend === 'down')    return '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>';
    if (trend === 'neutral') return '<line x1="5" y1="12" x2="19" y2="12"/>';
    return '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  }

  private lastSegment(url: string): string {
    if (!url) return 'Unknown';
    const parts = url.split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  }

  private buildFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = { limit: this.limit() };
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
    // Debounced fetch on filter change
    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.loading.set(true);
        const f = this.buildFilter();
        return this.dataProvider.getApiPerformanceStats(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: data => { this.mainData.set(data ?? []); this.loading.set(false); },
      error: ()  => { this.mainData.set([]); this.loading.set(false); },
    });

    // Separate error-data stream when detailed
    effect(() => {
      if (!this.detailed()) return;
      const f = { ...this.buildFilter(), limit: 1000, errorOnly: true };
      this.dataProvider.getApiPerformanceStats(f)
        .pipe(takeUntil(this.destroy$))
        .subscribe({ next: d => this.errorData.set(d ?? []), error: () => this.errorData.set([]) });
    });

    // Re-trigger on any filter change
    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source(); void this.limit();
      this.trigger$.next();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
