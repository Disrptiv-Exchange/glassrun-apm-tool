/**
 * ApmReleaseComparisonTableComponent  (selector: apm-release-comparison-table)
 * Ported from ReleaseComparisonTable.jsx (GR-9408).
 *
 * Shows latest 10 release versions with performance metrics.
 * Only rendered on mobile sources (source !== 'Portal') per React App.jsx.
 * Debounces 300 ms, cancels in-flight with switchMap.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { DateRange, ReleaseComparisonRow } from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

function fmtMs(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  return `${v.toFixed(1)}%`;
}

@Component({
  selector: 'apm-release-comparison-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 01-9 9"/>
          </svg>
          Release Comparison
        </h3>
        <p class="pd-card-desc">Performance metrics per release version (latest 10)</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (data().length === 0) {
          <div class="pd-empty" style="height:120px">
            <div class="pd-empty__title">No release data yet.</div>
            <div class="pd-empty__sub">Set <code>releaseVersion</code> in APM config to start tracking.</div>
          </div>
        } @else {
          <div class="apm-tbl__wrap">
            <table class="apm-tbl">
              <thead>
                <tr>
                  <th class="apm-tbl__th">Release</th>
                  <th class="apm-tbl__th">First Seen</th>
                  <th class="apm-tbl__th">Users</th>
                  <th class="apm-tbl__th">Sessions</th>
                  <th class="apm-tbl__th">Avg API</th>
                  <th class="apm-tbl__th">Avg Page</th>
                  <th class="apm-tbl__th">UI Errors</th>
                  <th class="apm-tbl__th">API Err Rate</th>
                </tr>
              </thead>
              <tbody>
                @for (r of data(); track r.releaseVersion) {
                  <tr class="apm-tbl__row">
                    <td class="apm-tbl__td"><span class="apm-tbl__badge">{{ r.releaseVersion }}</span></td>
                    <td class="apm-tbl__td" style="font-size:12px">{{ r.firstSeen?.split('T')[0] }}</td>
                    <td class="apm-tbl__td">{{ r.uniqueUsers?.toLocaleString() }}</td>
                    <td class="apm-tbl__td">{{ r.uniqueSessions?.toLocaleString() }}</td>
                    <td class="apm-tbl__td">{{ fmtMs(r.avgApiResponseTime) }}</td>
                    <td class="apm-tbl__td">{{ fmtMs(r.avgPageLoadTime) }}</td>
                    <td class="apm-tbl__td" [style.color]="r.uiErrorCount > 0 ? '#ef4444' : ''">
                      {{ r.uiErrorCount }}
                    </td>
                    <td class="apm-tbl__td" [style.color]="r.apiErrorRate > 5 ? '#ef4444' : ''">
                      {{ fmtPct(r.apiErrorRate) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
})
export class ApmReleaseComparisonTableComponent implements OnDestroy {
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('');

  readonly fmtMs  = fmtMs;
  readonly fmtPct = fmtPct;

  data    = signal<ReleaseComparisonRow[]>([]);
  loading = signal(true);

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
        const f: any = { limit: 10 };
        if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
        const src = this.source();
        if (src) f.source = src;
        const role = this.roleId();
        if (role && role !== 'all') f.roleId = role;
        const uid = this.userId();
        if (uid) f.userId = uid;
        const page = this.pageUrl();
        if (page && page !== 'all') f.pageUrl = page;
        return this.dp.getReleaseComparison(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d  => { this.data.set(Array.isArray(d) ? d : []); this.loading.set(false); },
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
