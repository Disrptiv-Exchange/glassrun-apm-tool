/**
 * ApmAlertsPanelComponent  (selector: apm-alerts-panel)
 *
 * Shows what is currently breaching a configured threshold, newest and worst first.
 *
 * Reads dbo.APMAlert via SSP_APM_GetAlerts. Rows are produced by
 * SSP_APM_EvaluateThresholds, which also queues the notification, so this panel is a view
 * of the same state the notification engine acted on - not a second, separate judgement.
 *
 * Status is surfaced deliberately:
 *   Pending  - breaching, but not yet confirmed. NOTHING has been notified.
 *   Open     - confirmed, notification raised.
 * Showing Pending separately is what stops the panel looking like it is silently sitting on
 * a problem it has not told anyone about.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { ApmAlert, AlertStatus } from '../models/apm-dashboard.models';
import { formatAgo } from '../utils/date-utils';

function fmtValue(v: number | null | undefined, unit: string | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  if (unit === 'pct')   return `${v.toFixed(2)}%`;
  if (unit === 'score') return v.toFixed(2);
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}

function agoFrom(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : formatAgo(d);
}

@Component({
  selector: 'apm-alerts-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Threshold Alerts
          @if (dangerCount() > 0) {
            <span class="apm-tbl__badge" style="background:#fee2e2;color:#b91c1c;margin-left:8px">
              {{ dangerCount() }} danger
            </span>
          }
          @if (warningCount() > 0) {
            <span class="apm-tbl__badge" style="background:#fef3c7;color:#92400e;margin-left:6px">
              {{ warningCount() }} warning
            </span>
          }
        </h3>
        <p class="pd-card-desc">
          Metrics outside their configured limits. Thresholds are set per metric in Threshold Configuration.
        </p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (data().length === 0) {
          <div class="pd-empty" style="height:120px">
            <div class="pd-empty__title">All metrics are within their thresholds.</div>
            <div class="pd-empty__sub">Alerts appear here as soon as a configured limit is breached.</div>
          </div>
        } @else {
          <div class="apm-tbl__wrap">
            <table class="apm-tbl">
              <thead>
                <tr>
                  <th class="apm-tbl__th">Severity</th>
                  <th class="apm-tbl__th">Metric</th>
                  <th class="apm-tbl__th">Scope</th>
                  <th class="apm-tbl__th">Observed</th>
                  <th class="apm-tbl__th">Limit</th>
                  <th class="apm-tbl__th">Over by</th>
                  <th class="apm-tbl__th">Samples</th>
                  <th class="apm-tbl__th">Since</th>
                  <th class="apm-tbl__th">State</th>
                </tr>
              </thead>
              <tbody>
                @for (a of data(); track a.apmAlertId) {
                  <tr class="apm-tbl__row">
                    <td class="apm-tbl__td">
                      <span class="apm-tbl__badge" [style.background]="sevBg(a)" [style.color]="sevFg(a)">
                        {{ a.severity }}
                      </span>
                    </td>
                    <td class="apm-tbl__td">{{ a.metricName || a.metricCode }}</td>
                    <td class="apm-tbl__td" style="font-size:12px">
                      {{ a.scope === 'Global' ? (a.source || 'all') : (a.scopeValue || a.scope) }}
                    </td>
                    <td class="apm-tbl__td" [style.color]="a.severity === 'Danger' ? '#ef4444' : '#d97706'">
                      <strong>{{ fmtValue(a.observedValue, a.unit) }}</strong>
                    </td>
                    <td class="apm-tbl__td">{{ fmtValue(a.thresholdValue, a.unit) }}</td>
                    <td class="apm-tbl__td">{{ a.overBy == null ? '—' : (a.overBy > 0 ? '+' : '') + a.overBy + '%' }}</td>
                    <td class="apm-tbl__td">{{ a.sampleCount ?? '—' }}</td>
                    <td class="apm-tbl__td" style="font-size:12px">{{ agoFrom(a.firstDetectedDate) }}</td>
                    <td class="apm-tbl__td" style="font-size:12px">
                      @if (a.status === 'Pending') {
                        <span [title]="'Breaching but not yet confirmed - no notification sent'">
                          Pending ({{ a.breachCount }})
                        </span>
                      } @else if (a.status === 'Resolved') {
                        Resolved
                      } @else {
                        <span [title]="'Notified ' + (a.notifyCount || 0) + ' time(s)'">Open</span>
                      }
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
export class ApmAlertsPanelComponent implements OnDestroy {
  /** 'Active' (default) shows Pending + Open. Pass 'all' for full history. */
  status     = input<AlertStatus | 'Active' | 'all'>('Active');
  source     = input<string>('');
  metricCode = input<string>('');
  limit      = input<number>(50);
  /** Bump to refetch, e.g. after saving a threshold rule. */
  refreshKey = input<number>(0);

  readonly fmtValue = fmtValue;
  readonly agoFrom  = agoFrom;

  data    = signal<ApmAlert[]>([]);
  loading = signal(true);

  dangerCount  = computed(() => this.data().filter(a => a.severity === 'Danger'  && a.status !== 'Resolved').length);
  warningCount = computed(() => this.data().filter(a => a.severity === 'Warning' && a.status !== 'Resolved').length);

  private dp = inject(ApmDashboardDataProvider);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  sevBg(a: ApmAlert): string {
    if (a.status === 'Resolved') return '#f1f5f9';
    return a.severity === 'Danger' ? '#fee2e2' : '#fef3c7';
  }
  sevFg(a: ApmAlert): string {
    if (a.status === 'Resolved') return '#64748b';
    return a.severity === 'Danger' ? '#b91c1c' : '#92400e';
  }

  constructor() {
    if (!this.isBrowser) return;

    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.loading.set(true);
        const f: any = { status: this.status(), limit: this.limit() };
        const src = this.source();
        if (src && src !== 'all') f.source = src;
        const mc = this.metricCode();
        if (mc && mc !== 'all') f.metricCode = mc;
        return this.dp.getAlerts(f);
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: d  => { this.data.set(Array.isArray(d) ? d : []); this.loading.set(false); },
      error: () => { this.data.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.status(); void this.source(); void this.metricCode();
      void this.limit(); void this.refreshKey();
      this.trigger$.next();
    });

    this.trigger$.next();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
