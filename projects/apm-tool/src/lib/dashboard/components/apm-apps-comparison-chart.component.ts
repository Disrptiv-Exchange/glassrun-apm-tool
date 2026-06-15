/**
 * ApmAppsComparisonChartComponent  (selector: apm-apps-comparison-chart)
 * Ported from AppsComparisonChart.jsx (GR-9408).
 *
 * Shows per-app KPI cards (Portal / CustomerAPP / DeliveryAPP / YardAPP) plus
 * a grouped bar chart comparing API time, page load, and error rate side-by-side.
 *
 * The trigger button for this tab is intentionally hidden in the shell (keeps
 * parity with the React App.jsx). The content is still fully implemented.
 *
 * Calls getAppComparison. Debounced 300 ms, switchMap.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { DateRange, AppComparisonStats } from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';
import { ApmGroupedBarChartComponent, GroupedBarSeries } from '../charts/apm-grouped-bar-chart.component';

const APP_COLORS: Record<string, string> = {
  Portal:      '#3b82f6',
  CustomerAPP: '#10b981',
  DeliveryAPP: '#f59e0b',
  YardAPP:     '#8b5cf6',
};

// SVG paths for app icons (inline, no lucide/heroicons dep)
const APP_ICON_PATHS: Record<string, string> = {
  Portal:      'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  CustomerAPP: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
  DeliveryAPP: 'M1 3h15v13H1zM16 8h4l3 3v5h-7V8z M5.5 21a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM18.5 21a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  YardAPP:     'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
};

function fmtMs(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${Math.round(v)}ms`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  return `${v.toFixed(1)}%`;
}

@Component({
  selector: 'apm-apps-comparison-chart',
  standalone: true,
  imports: [ApmGroupedBarChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (loading()) {
      <div class="pd-card">
        <div class="pd-card-header"><h3 class="pd-card-title">Apps Comparison</h3></div>
        <div class="pd-card-body"><div class="pd-spinner-wrap"><div class="pd-spinner"></div></div></div>
      </div>
    } @else if (data().length === 0) {
      <div class="pd-card">
        <div class="pd-card-header">
          <h3 class="pd-card-title">Apps Comparison</h3>
          <p class="pd-card-desc">No data for the selected period</p>
        </div>
      </div>
    } @else {
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- KPI cards per app -->
        <div class="apm-apps__grid">
          @for (app of data(); track app.appName) {
            <div class="pd-card">
              <div class="pd-card-header" style="padding-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <h3 class="pd-card-title" style="margin:0;font-size:13px">{{ app.appName }}</h3>
                  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
                    viewBox="0 0 24 24" [style.stroke]="appColor(app.appName)">
                    <path [attr.d]="appIconPath(app.appName)"/>
                  </svg>
                </div>
              </div>
              <div class="pd-card-body" style="padding-top:8px">
                <div class="apm-apps__kpi-row">
                  <div class="apm-apps__kpi-line">
                    <span class="apm-apps__kpi-key">API</span>
                    <span class="apm-apps__kpi-val">{{ fmtMs(app.avgApiResponseTime) }}</span>
                  </div>
                  <div class="apm-apps__kpi-line">
                    <span class="apm-apps__kpi-key">Page</span>
                    <span class="apm-apps__kpi-val">{{ fmtMs(app.avgPageLoadTime) }}</span>
                  </div>
                  <div class="apm-apps__kpi-line">
                    <span class="apm-apps__kpi-key">Calls</span>
                    <span class="apm-apps__kpi-val">{{ (app.totalApiCalls || 0).toLocaleString() }}</span>
                  </div>
                  <div class="apm-apps__kpi-line">
                    <span class="apm-apps__kpi-key">Errors</span>
                    <span class="apm-apps__kpi-val" [style.color]="app.errorRate > 5 ? '#ef4444' : ''">{{ fmtPct(app.errorRate) }}</span>
                  </div>
                  <div class="apm-apps__kpi-line">
                    <span class="apm-apps__kpi-key">Users</span>
                    <span class="apm-apps__kpi-val">{{ (app.uniqueUsers || 0).toLocaleString() }}</span>
                  </div>
                  <div class="apm-apps__kpi-line">
                    <span class="apm-apps__kpi-key">Sessions</span>
                    <span class="apm-apps__kpi-val">{{ (app.uniqueSessions || 0).toLocaleString() }}</span>
                  </div>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Comparison bar chart -->
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">Apps Performance Comparison</h3>
            <p class="pd-card-desc">Response times and error rates side-by-side</p>
          </div>
          <div class="pd-card-body">
            <apm-grouped-bar-chart
              [data]="chartRows()"
              [series]="comparisonSeries"
              [height]="320"
              [yLabelFn]="fmtMs"
            />
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .apm-apps__grid { display:grid;grid-template-columns:repeat(4,1fr);gap:12px; }
    @media (max-width:1100px) { .apm-apps__grid { grid-template-columns:repeat(2,1fr); } }
    @media (max-width:600px)  { .apm-apps__grid { grid-template-columns:1fr; } }
    .apm-apps__kpi-row { display:flex;flex-direction:column;gap:4px; }
    .apm-apps__kpi-line { display:flex;justify-content:space-between;font-size:12px; }
    .apm-apps__kpi-key { color:var(--pd-text-muted); }
    .apm-apps__kpi-val { font-weight:500;color:var(--pd-text); }
  `],
})
export class ApmAppsComparisonChartComponent implements OnDestroy {
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('');

  readonly fmtMs  = fmtMs;
  readonly fmtPct = fmtPct;

  appColor(name: string): string { return APP_COLORS[name] ?? '#64748b'; }
  appIconPath(name: string): string { return APP_ICON_PATHS[name] ?? APP_ICON_PATHS['Portal']; }

  data    = signal<AppComparisonStats[]>([]);
  loading = signal(true);

  chartRows = computed(() =>
    this.data().map(d => ({
      name: d.appName,
      'Avg API (ms)':       Math.round(d.avgApiResponseTime || 0),
      'Avg Page Load (ms)': Math.round(d.avgPageLoadTime || 0),
    }))
  );

  readonly comparisonSeries: GroupedBarSeries[] = [
    { key: 'Avg API (ms)',       color: '#3b82f6', label: 'Avg API (ms)'       },
    { key: 'Avg Page Load (ms)', color: '#10b981', label: 'Avg Page Load (ms)' },
  ];

  private dp = inject(ApmDashboardDataProvider);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

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
        const f: any = {};
        if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
        const src = this.source();
        if (src) f.source = src;
        const role = this.roleId();
        if (role && role !== 'all') f.roleId = role;
        const uid = this.userId();
        if (uid) f.userId = uid;
        const page = this.pageUrl();
        if (page && page !== 'all') f.pageUrl = page;
        return this.dp.getAppComparison(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d => {
        const arr = Array.isArray(d) ? d : ((d as any)?.Items ?? []);
        this.data.set(arr);
        this.loading.set(false);
      },
      error: () => { this.data.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source();
      this.trigger$.next();
    });

    this.trigger$.next();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
