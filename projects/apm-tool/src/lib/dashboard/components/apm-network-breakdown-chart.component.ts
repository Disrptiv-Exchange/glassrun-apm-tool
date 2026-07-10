/**
 * ApmNetworkBreakdownChartComponent  (selector: apm-network-breakdown-chart)
 * Ported from NetworkBreakdownChart.jsx (GR-9408).
 *
 * Two side-by-side panels:
 *  - By Connection Type (WiFi / Cellular / Ethernet) — grouped bar chart
 *  - By Effective Speed (4G / 3G / 2G / slow-2g) — donut pie + legend rows
 *
 * Calls getNetworkBreakdown. Debounced 300 ms, switchMap.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { DateRange, NetworkBreakdown, NetworkBreakdownRow } from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';
import { ApmGroupedBarChartComponent, GroupedBarSeries } from '../charts/apm-grouped-bar-chart.component';
import { ApmPieChartComponent, PieSlice } from '../charts/apm-pie-chart.component';

const EFFECTIVE_COLORS: Record<string, string> = {
  '4g': '#10b981', '3g': '#f59e0b', '2g': '#ef4444', 'slow-2g': '#991b1b', 'unknown': '#64748b',
};
const NETWORK_COLORS: Record<string, string> = {
  wifi: '#3b82f6', cellular: '#10b981', ethernet: '#8b5cf6', unknown: '#64748b',
};

function fmtMs(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${Math.round(v)}ms`;
}

@Component({
  selector: 'apm-network-breakdown-chart',
  standalone: true,
  imports: [ApmGroupedBarChartComponent, ApmPieChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (loading()) {
      <div class="pd-card">
        <div class="pd-card-header">
          <h3 class="pd-card-title">Network Performance</h3>
        </div>
        <div class="pd-card-body">
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        </div>
      </div>
    } @else if (byType().length === 0 && byEffective().length === 0) {
      <div class="pd-card">
        <div class="pd-card-header">
          <h3 class="pd-card-title">Network Performance</h3>
          <p class="pd-card-desc">No network data captured yet.</p>
        </div>
      </div>
    } @else {
      <div class="pd-overview-grid">
        <!-- By Connection Type -->
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/>
                <path d="M10.54 16a5 5 0 012.92 0"/><circle cx="12" cy="20" r="1"/>
              </svg>
              By Connection Type
            </h3>
            <p class="pd-card-desc">Response time + volume by network type</p>
          </div>
          <div class="pd-card-body">
            @if (byType().length === 0) {
              <div class="pd-empty" style="height:80px"><div class="pd-empty__title">No data.</div></div>
            } @else {
              <apm-grouped-bar-chart
                [data]="connectionBarData()"
                [series]="connectionSeries"
                [height]="220"
                [yLabelFn]="fmtMs"
              />
              <div style="margin-top:10px;font-size:12px;display:flex;flex-direction:column;gap:4px">
                @for (r of byType(); track r.name) {
                  <div style="display:flex;justify-content:space-between">
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <span style="display:inline-block;width:8px;height:8px;border-radius:50%"
                        [style.background]="getNetColor(r.name)"></span>
                      <span style="text-transform:capitalize">{{ r.name || 'unknown' }}</span>
                    </span>
                    <span style="color:var(--pd-text-muted)">
                      {{ r.count?.toLocaleString() }} calls &middot; {{ r.avgDownlinkMbps?.toFixed(1) }} Mbps
                    </span>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <!-- By Effective Speed -->
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M0 9l3-3 3 3M6 6v12M8 15l3 3 3-3M14 18V6M16 9l3-3 3 3M22 6v12"/>
              </svg>
              By Effective Speed
            </h3>
            <p class="pd-card-desc">4G / 3G / 2G distribution + response time</p>
          </div>
          <div class="pd-card-body">
            @if (byEffective().length === 0) {
              <div class="pd-empty" style="height:80px"><div class="pd-empty__title">No data.</div></div>
            } @else {
              <div style="display:flex;align-items:flex-start;gap:16px">
                <apm-pie-chart
                  [data]="effectivePieSlices()"
                  [size]="180"
                  [donut]="true"
                />
                <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;padding-top:8px">
                  @for (r of byEffective(); track r.name) {
                    <div>
                      <div style="display:inline-flex;align-items:center;gap:6px;font-weight:600">
                        <span style="display:inline-block;width:8px;height:8px;border-radius:50%"
                          [style.background]="getEffColor(r.name)"></span>
                        <span style="text-transform:uppercase">{{ r.name || 'unknown' }}</span>
                      </div>
                      <div style="color:var(--pd-text-muted);padding-left:14px">
                        {{ r.count?.toLocaleString() }} calls &middot; {{ fmtMs(r.avgApiResponseTime) }} API
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class ApmNetworkBreakdownChartComponent implements OnDestroy {
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('');

  readonly fmtMs = fmtMs;
  getNetColor(name: string): string { return NETWORK_COLORS[name?.toLowerCase()] ?? '#64748b'; }
  getEffColor(name: string): string { return EFFECTIVE_COLORS[name?.toLowerCase()] ?? '#64748b'; }

  breakdown = signal<NetworkBreakdown | null>(null);
  loading   = signal(true);

  byType      = () => this.breakdown()?.byNetworkType ?? [];
  byEffective = () => this.breakdown()?.byEffectiveType ?? [];

  readonly connectionSeries: GroupedBarSeries[] = [
    { key: 'Avg API (ms)',  color: '#3b82f6', label: 'Avg API (ms)'  },
    { key: 'Avg Page (ms)', color: '#10b981', label: 'Avg Page (ms)' },
  ];

  connectionBarData = () =>
    this.byType().map(r => ({
      name: r.name || 'unknown',
      'Avg API (ms)':  Math.round(r.avgApiResponseTime || 0),
      'Avg Page (ms)': Math.round(r.avgPageLoadTime || 0),
    }));

  effectivePieSlices = (): PieSlice[] =>
    this.byEffective().map(r => ({
      label: r.name || 'unknown',
      value: r.count || 0,
      color: EFFECTIVE_COLORS[r.name?.toLowerCase()] ?? '#64748b',
    }));

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
        return this.dp.getNetworkBreakdown(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d  => { this.breakdown.set(d); this.loading.set(false); },
      error: () => { this.breakdown.set(null); this.loading.set(false); },
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
