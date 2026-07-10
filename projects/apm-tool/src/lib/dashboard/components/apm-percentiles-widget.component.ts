/**
 * ApmPercentilesWidgetComponent  (selector: apm-percentiles-widget)
 * Ported from PercentilesWidget.jsx (GR-9408).
 *
 * P50/P75/P90/P95/P99 bar display for any metric.
 * User can switch metric via an inline select.
 * Calls getPercentiles — debounced 300 ms.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { DateRange, PercentileStats } from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

interface MetricOption { value: string; label: string; }

const METRICS: MetricOption[] = [
  { value: 'api_response_time', label: 'API Response Time' },
  { value: 'page_load_time',    label: 'Page Load Time' },
  { value: 'fcp',               label: 'First Contentful Paint' },
  { value: 'lcp',               label: 'Largest Contentful Paint' },
  { value: 'inp',               label: 'Interaction to Next Paint' },
];

const PCT_COLORS: Record<string, string> = {
  P50: '#10b981', P75: '#22c55e', P90: '#f59e0b', P95: '#f97316', P99: '#ef4444',
};

function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}

@Component({
  selector: 'apm-percentiles-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <h3 class="pd-card-title">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="2" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/>
                <rect x="18" y="5" width="4" height="16"/>
              </svg>
              Percentile Distribution
            </h3>
            <p class="pd-card-desc">
              {{ activeMetricLabel() }} &middot;
              {{ (stats()?.sampleCount ?? 0).toLocaleString() }} samples &middot;
              Avg: {{ fmt(stats()?.average) }}
            </p>
          </div>
          <select class="pd-field pd-field--select" style="min-width:200px"
            [value]="selectedMetric()" (change)="onMetricChange($event)">
            @for (m of metrics; track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        </div>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (!stats() || (stats()?.sampleCount ?? 0) === 0) {
          <div class="pd-empty" style="height:160px">
            <div class="pd-empty__title">No samples for {{ activeMetricLabel() }}</div>
          </div>
        } @else {
          <!-- Bar chart (inline SVG) -->
          <div class="apm-pct__bars">
            @for (row of chartRows(); track row.name) {
              <div class="apm-pct__bar-group">
                <div class="apm-pct__bar-wrap">
                  <div class="apm-pct__bar"
                    [style.height]="row.heightPct + '%'"
                    [style.background]="row.color">
                  </div>
                </div>
                <div class="apm-pct__bar-label" [style.color]="row.color">{{ fmt(row.value) }}</div>
                <div class="apm-pct__bar-name">{{ row.name }}</div>
              </div>
            }
          </div>
          <!-- Footer summary row -->
          <div class="apm-pct__footer">
            @for (row of chartRows(); track row.name) {
              <div class="apm-pct__footer-cell">
                <div class="apm-pct__footer-name" style="color:var(--pd-text-muted)">{{ row.name }}</div>
                <div class="apm-pct__footer-val" [style.color]="row.color">{{ fmt(row.value) }}</div>
              </div>
            }
          </div>
          <!-- P95 explainer -->
          <div style="margin-top:12px;font-size:11px;color:var(--pd-text-muted)">
            <strong>P95 = {{ fmt(stats()!.p95) }}</strong> means 95% of requests finish in under {{ fmt(stats()!.p95) }}.
            The other 5% are the slowest users — usually where real problems hide.
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .apm-pct__bars { display:flex;align-items:flex-end;gap:12px;height:180px;padding:0 4px; }
    .apm-pct__bar-group { flex:1;display:flex;flex-direction:column;align-items:center; }
    .apm-pct__bar-wrap { flex:1;width:100%;display:flex;align-items:flex-end;padding:0 4px; }
    .apm-pct__bar { width:100%;border-radius:4px 4px 0 0;transition:height 0.3s ease;min-height:2px; }
    .apm-pct__bar-label { font-size:11px;font-weight:600;margin-top:4px;white-space:nowrap; }
    .apm-pct__bar-name { font-size:11px;color:var(--pd-text-muted);margin-top:2px; }
    .apm-pct__footer { display:flex;gap:0;margin-top:16px;border-top:1px solid var(--pd-border);padding-top:12px; }
    .apm-pct__footer-cell { flex:1;text-align:center; }
    .apm-pct__footer-name { font-size:11px;color:var(--pd-text-muted);margin-bottom:2px; }
    .apm-pct__footer-val { font-size:14px;font-weight:700; }
  `],
})
export class ApmPercentilesWidgetComponent implements OnDestroy {
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('');

  readonly metrics = METRICS;
  readonly fmt = fmt;

  selectedMetric = signal<string>('api_response_time');
  stats   = signal<PercentileStats | null>(null);
  loading = signal(true);

  activeMetricLabel = computed(() => METRICS.find(m => m.value === this.selectedMetric())?.label ?? this.selectedMetric());

  chartRows = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const rows = [
      { name: 'P50', value: s.p50 ?? 0 },
      { name: 'P75', value: s.p75 ?? 0 },
      { name: 'P90', value: s.p90 ?? 0 },
      { name: 'P95', value: s.p95 ?? 0 },
      { name: 'P99', value: s.p99 ?? 0 },
    ];
    const maxVal = Math.max(...rows.map(r => r.value), 1);
    return rows.map(r => ({
      ...r,
      color: PCT_COLORS[r.name] ?? '#64748b',
      heightPct: (r.value / maxVal) * 90 + 5,
    }));
  });

  private dp = inject(ApmDashboardDataProvider);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  onMetricChange(event: Event): void {
    this.selectedMetric.set((event.target as HTMLSelectElement).value);
  }

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
        const f: any = { metric: this.selectedMetric() };
        if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
        const src = this.source();
        if (src) f.source = src;
        const role = this.roleId();
        if (role && role !== 'all') f.roleId = role;
        const uid = this.userId();
        if (uid) f.userId = uid;
        const page = this.pageUrl();
        if (page && page !== 'all') f.pageUrl = page;
        return this.dp.getPercentiles(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d  => { this.stats.set(d ?? null); this.loading.set(false); },
      error: () => { this.stats.set(null); this.loading.set(false); },
    });

    effect(() => {
      void this.selectedMetric(); void this.dateRange(); void this.roleId();
      void this.userId(); void this.pageUrl(); void this.source();
      this.trigger$.next();
    });

    this.trigger$.next();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
