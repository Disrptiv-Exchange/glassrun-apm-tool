/**
 * ApmTimeSeriesChartComponent  (selector: apm-time-series-chart)
 * Ported from TimeSeriesChart.jsx (GR-9408).
 *
 * Single-metric hourly trend line. Used 4× in the Trends tab (page_load_time,
 * api_response_time, fcp, inp). Fetches getTimeSeriesData via injected provider.
 * Debounces 300 ms, cancels in-flight with switchMap.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { DateRange, TimeSeriesMetric, TimeSeriesDataPoint } from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';
import { ApmLineChartComponent } from '../charts/apm-line-chart.component';

const METRIC_COLORS: Record<TimeSeriesMetric, string> = {
  page_load_time:    '#ef4444',
  api_response_time: '#3b82f6',
  fcp:               '#22c55e',
  inp:               '#f59e0b',
};

@Component({
  selector: 'apm-time-series-chart',
  standalone: true,
  imports: [ApmLineChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div>
            <h3 class="pd-card-title">{{ title() }}</h3>
            <p class="pd-card-desc">Hourly trend analysis</p>
          </div>
        </div>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (data().length === 0) {
          <div class="pd-empty" style="height:192px">
            <svg width="40" height="40" fill="none" stroke="#d1d5db" stroke-width="1.5" viewBox="0 0 24 24">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            </svg>
            <div class="pd-empty__title">No data for this period</div>
          </div>
        } @else {
          <apm-line-chart
            [data]="lineData()"
            xKey="timestamp"
            valueKey="value"
            [color]="lineColor()"
            [height]="256"
            [valueFormatFn]="fmtValue"
            [xFormatFn]="fmtX"
            [xFullFormatFn]="fmtXFull"
            [showFooter]="true"
          />
        }
      </div>
    </div>
  `,
})
export class ApmTimeSeriesChartComponent implements OnDestroy {
  metric   = input.required<TimeSeriesMetric>();
  title    = input<string>('Time Series');
  dateRange = input<DateRange>({ from: null, to: null });
  roleId   = input<string>('');
  userId   = input<string | undefined>(undefined);
  pageUrl  = input<string>('');
  source   = input<string>('');

  private dp = inject(ApmDashboardDataProvider);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  data    = signal<TimeSeriesDataPoint[]>([]);
  loading = signal(true);

  lineColor = computed(() => METRIC_COLORS[this.metric()] ?? '#26547c');

  lineData = computed(() =>
    this.data().map(p => ({ timestamp: p.timestamp, value: p.value, label: p.label }))
  );

  fmtValue = (v: number): string => {
    return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
  };

  fmtX = (x: string): string => {
    const d = new Date(x);
    if (isNaN(d.getTime())) return x.slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  fmtXFull = (x: string): string => {
    const d = new Date(x);
    if (isNaN(d.getTime())) return x;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  constructor() {
    if (!this.isBrowser) return;

    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.loading.set(true);
        const dr = this.dateRange();
        let from = dr.from;
        let to   = dr.to;
        if (from && !to) to = getEndOfDay(from);
        const f: any = { metric: this.metric(), interval: 'hour' };
        if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
        const role = this.roleId();
        if (role && role !== 'all') f.roleId = role;
        const uid = this.userId();
        if (uid) f.userId = uid;
        const page = this.pageUrl();
        if (page && page !== 'all') f.pageUrl = page;
        const src = this.source();
        if (src) f.source = src;
        return this.dp.getTimeSeriesData(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d  => { this.data.set(d ?? []); this.loading.set(false); },
      error: () => { this.data.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.metric(); void this.dateRange(); void this.roleId();
      void this.userId(); void this.pageUrl(); void this.source();
      this.trigger$.next();
    });

    this.trigger$.next();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
