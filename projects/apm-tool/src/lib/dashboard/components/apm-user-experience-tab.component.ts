/**
 * ApmUserExperienceTabComponent  (selector: apm-user-experience-tab)
 * Ported from UserExperienceTab.jsx (GR-9408).
 *
 * Sections:
 *   1. Apdex Score Trend (line chart) + User Satisfaction donut
 *   2. Bounce Rate Trend (line chart)  + Top Exit Pages table
 *   3. Offline Session Activity  (hidden when hideOffline = true, i.e. source = Portal)
 *
 * Calls: getApdexScore / getBounceRate / getExitPages / getOfflineStats
 * All debounced 300 ms, switchMap.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, forkJoin, of } from 'rxjs';
import { switchMap, debounceTime, takeUntil, catchError } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import {
  DateRange, ApdexTimePoint, BounceRateTimePoint, ExitPageRow, OfflineStats,
} from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';
import { ApmLineChartComponent } from '../charts/apm-line-chart.component';
import { ApmGroupedBarChartComponent, GroupedBarSeries } from '../charts/apm-grouped-bar-chart.component';
import { ApmPieChartComponent, PieSlice } from '../charts/apm-pie-chart.component';

const APDEX_COLORS = { satisfied: '#10b981', tolerating: '#f59e0b', frustrated: '#ef4444' };

function fmtMs(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${Math.round(v)}ms`;
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'N/A';
  return `${v.toFixed(1)}%`;
}
function fmtNum(v: number): string { return v.toLocaleString(); }

@Component({
  selector: 'apm-user-experience-tab',
  standalone: true,
  imports: [ApmLineChartComponent, ApmGroupedBarChartComponent, ApmPieChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div style="display:flex;flex-direction:column;gap:16px">

      <!-- 1. Apdex -->
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px" class="apm-ux__apdex-grid">
        <!-- Trend -->
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M12 22C6.48 22 2 17.52 2 12S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10z"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              Apdex Score Trend
            </h3>
            <p class="pd-card-desc">User satisfaction score (0–1) based on 500ms threshold</p>
          </div>
          <div class="pd-card-body">
            @if (loading()) {
              <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
            } @else if (apdexLineData().length === 0) {
              <div class="pd-empty" style="height:120px"><div class="pd-empty__title">No data.</div></div>
            } @else {
              <apm-line-chart
                [data]="apdexLineData()"
                xKey="time"
                valueKey="Apdex"
                color="#10b981"
                [height]="240"
                [valueFormatFn]="fmtApdex"
                [xFormatFn]="fmtDate"
                [xFullFormatFn]="fmtDateFull"
                [yMinOverride]="0"
                [yMaxOverride]="1"
              />
            }
          </div>
        </div>

        <!-- Satisfaction donut + score -->
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 13s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/>
                <line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              User Satisfaction
            </h3>
          </div>
          <div class="pd-card-body" style="display:flex;flex-direction:column;align-items:center;gap:12px">
            @if (!apdexSummary()) {
              <div class="pd-empty" style="height:120px"><div class="pd-empty__title">No data.</div></div>
            } @else {
              <div style="text-align:center">
                <div style="font-size:40px;font-weight:700;color:var(--pd-text)">
                  {{ apdexSummary()!.overall.toFixed(2) }}
                </div>
                <div style="font-size:12px;color:var(--pd-text-muted)">Overall Apdex</div>
              </div>
              <apm-pie-chart [data]="apdexPieSlices()" [size]="160" [donut]="true"/>
            }
          </div>
        </div>
      </div>

      <!-- 2. Bounce Rate + Exit Pages -->
      <div class="pd-overview-grid">
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/>
              </svg>
              Bounce Rate Trend
            </h3>
            <p class="pd-card-desc">% of sessions with only 1 page view</p>
          </div>
          <div class="pd-card-body">
            @if (loading()) {
              <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
            } @else if (bounceLineData().length === 0) {
              <div class="pd-empty" style="height:120px"><div class="pd-empty__title">No data.</div></div>
            } @else {
              <apm-line-chart
                [data]="bounceLineData()"
                xKey="date"
                valueKey="Bounce Rate (%)"
                color="#f59e0b"
                [height]="220"
                [valueFormatFn]="fmtPct2"
                [xFormatFn]="fmtDate"
                [xFullFormatFn]="fmtDateFull"
                [yMinOverride]="0"
                [yMaxOverride]="100"
              />
            }
          </div>
        </div>

        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">Top Exit Pages</h3>
            <p class="pd-card-desc">Pages where users leave most often</p>
          </div>
          <div class="pd-card-body">
            @if (loading()) {
              <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
            } @else if (exitPages().length === 0) {
              <div class="pd-empty" style="height:120px"><div class="pd-empty__title">No data.</div></div>
            } @else {
              <div class="apm-tbl__wrap">
                <table class="apm-tbl">
                  <thead>
                    <tr>
                      <th class="apm-tbl__th">Page</th>
                      <th class="apm-tbl__th">Exits</th>
                      <th class="apm-tbl__th">Exit Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of exitPages().slice(0,10); track r.pageUrl) {
                      <tr class="apm-tbl__row">
                        <td class="apm-tbl__td" style="font-weight:500">{{ r.pageUrl }}</td>
                        <td class="apm-tbl__td">{{ r.exitCount }}</td>
                        <td class="apm-tbl__td" [style.color]="r.exitRate > 70 ? '#ef4444' : ''">
                          {{ fmtPct(r.exitRate) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- 3. Offline Stats (hidden for Portal) -->
      @if (!hideOffline()) {
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/>
                <path d="M5 12.55a10.94 10.94 0 015.17-2.39"/>
                <path d="M10.71 5.05A16 16 0 0122.56 9"/>
                <path d="M1.42 9a15.91 15.91 0 014.7-2.88"/>
                <path d="M8.53 16.11a6 6 0 016.95 0"/>
                <line x1="12" y1="20" x2="12.01" y2="20"/>
              </svg>
              Offline Session Activity
            </h3>
            <p class="pd-card-desc">Logs queued offline and flushed when network came back</p>
          </div>
          <div class="pd-card-body">
            @if (loadingOffline()) {
              <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
            } @else if (!offline() || offline()!.offlineQueuedCount === 0) {
              <div class="pd-empty" style="height:80px">
                <div class="pd-empty__title" style="color:#047857">No offline logs in this period (that's a good thing).</div>
              </div>
            } @else {
              <div class="apm-mobile__kpi-row" style="margin-bottom:16px">
                <div class="apm-mobile__kpi">
                  <div class="apm-mobile__kpi-label">Offline Logs</div>
                  <div class="apm-mobile__kpi-val">{{ fmtNum(offline()!.offlineQueuedCount) }}</div>
                </div>
                <div class="apm-mobile__kpi">
                  <div class="apm-mobile__kpi-label">% of Total</div>
                  <div class="apm-mobile__kpi-val">{{ fmtPct(offline()!.offlineQueuedPercentage) }}</div>
                </div>
                <div class="apm-mobile__kpi">
                  <div class="apm-mobile__kpi-label">Avg Queue Time</div>
                  <div class="apm-mobile__kpi-val">{{ fmtMs(offline()!.avgQueueDurationMs) }}</div>
                </div>
                <div class="apm-mobile__kpi">
                  <div class="apm-mobile__kpi-label">Affected Sessions</div>
                  <div class="apm-mobile__kpi-val">{{ fmtNum(offline()!.affectedSessions) }}</div>
                </div>
                <div class="apm-mobile__kpi">
                  <div class="apm-mobile__kpi-label">Affected Users</div>
                  <div class="apm-mobile__kpi-val">{{ fmtNum(offline()!.affectedUsers) }}</div>
                </div>
              </div>
              @if (offline()!.trend?.length) {
                <apm-grouped-bar-chart
                  [data]="offlineTrendData()"
                  [series]="offlineSeries"
                  [height]="180"
                  [xLabelFn]="fmtDate"
                  [yLabelFn]="fmtCount"
                />
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .apm-ux__apdex-grid { display:grid;grid-template-columns:2fr 1fr;gap:16px; }
    @media (max-width:900px) { .apm-ux__apdex-grid { grid-template-columns:1fr; } }
    .apm-mobile__kpi-row { display:flex;flex-wrap:wrap;gap:12px; }
    .apm-mobile__kpi { flex:1;min-width:140px;padding:10px 12px;border-radius:8px;background:var(--pd-surface-muted);border:1px solid var(--pd-border); }
    .apm-mobile__kpi-label { font-size:11px;color:var(--pd-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px; }
    .apm-mobile__kpi-val { font-size:20px;font-weight:700;color:var(--pd-text);font-variant-numeric:tabular-nums; }
  `],
})
export class ApmUserExperienceTabComponent implements OnDestroy {
  dateRange   = input<DateRange>({ from: null, to: null });
  roleId      = input<string>('');
  userId      = input<string | undefined>(undefined);
  pageUrl     = input<string>('');
  source      = input<string>('');
  hideOffline = input<boolean>(false);

  readonly fmtMs   = fmtMs;
  readonly fmtPct  = fmtPct;
  readonly fmtNum  = fmtNum;

  apdex      = signal<ApdexTimePoint[]>([]);
  bounce     = signal<BounceRateTimePoint[]>([]);
  exitPages  = signal<ExitPageRow[]>([]);
  offline    = signal<OfflineStats | null>(null);
  loading       = signal(true);
  loadingOffline = signal(true);

  apdexLineData = computed(() =>
    this.apdex().map(p => ({ time: p.timeBucket, Apdex: Number((p.apdex || 0).toFixed(3)) }))
  );

  bounceLineData = computed(() =>
    this.bounce().map(p => ({ date: p.timeBucket, 'Bounce Rate (%)': Number((p.bounceRate || 0).toFixed(1)) }))
  );

  apdexSummary = computed(() => {
    const pts = this.apdex();
    if (!pts.length) return null;
    const satisfied  = pts.reduce((s, r) => s + (r.satisfied  || 0), 0);
    const tolerating = pts.reduce((s, r) => s + (r.tolerating || 0), 0);
    const frustrated = pts.reduce((s, r) => s + (r.frustrated || 0), 0);
    const total      = pts.reduce((s, r) => s + (r.totalSamples || 0), 0);
    const overall    = pts.reduce((s, r) => s + r.apdex * (r.totalSamples || 0), 0) / Math.max(1, total);
    return { satisfied, tolerating, frustrated, total, overall };
  });

  apdexPieSlices = computed((): PieSlice[] => {
    const s = this.apdexSummary();
    if (!s) return [];
    return [
      { label: 'Satisfied',  value: s.satisfied,  color: APDEX_COLORS.satisfied  },
      { label: 'Tolerating', value: s.tolerating, color: APDEX_COLORS.tolerating },
      { label: 'Frustrated', value: s.frustrated, color: APDEX_COLORS.frustrated },
    ];
  });

  offlineTrendData = computed(() =>
    (this.offline()?.trend ?? []).map(t => ({
      name: t.date,
      Offline: t.offlineCount,
      Total: t.totalCount,
    }))
  );

  readonly offlineSeries: GroupedBarSeries[] = [
    { key: 'Offline', color: '#ef4444', label: 'Offline' },
    { key: 'Total',   color: '#64748b', label: 'Total'   },
  ];

  fmtApdex   = (v: number): string => v.toFixed(3);
  fmtPct2    = (v: number): string => `${v.toFixed(1)}%`;
  fmtDate    = (x: string): string => x?.slice(0, 10) ?? x;
  fmtDateFull = (x: string): string => x?.slice(0, 16).replace('T', ' ') ?? x;
  fmtCount   = (v: number): string => v >= 1000 ? `${(v/1000).toFixed(1)}k` : Math.round(v).toString();

  private dp = inject(ApmDashboardDataProvider);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  private buildFilter(): any {
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
    return f;
  }

  constructor() {
    if (!this.isBrowser) return;

    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.loading.set(true);
        this.loadingOffline.set(true);
        const f = this.buildFilter();
        const offlineReq = this.hideOffline()
          ? of(null)
          : this.dp.getOfflineStats(f).pipe(catchError(() => of(null)));

        return forkJoin({
          apdex:     this.dp.getApdexScore({ ...f, interval: 'hour', apdexT: 500 }),
          bounce:    this.dp.getBounceRate({ ...f, interval: 'day' }),
          exitPages: this.dp.getExitPages({ ...f, limit: 15 }),
          offline:   offlineReq,
        });
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: r => {
        this.apdex.set(Array.isArray(r.apdex) ? r.apdex : []);
        this.bounce.set(Array.isArray(r.bounce) ? r.bounce : []);
        this.exitPages.set(Array.isArray(r.exitPages) ? r.exitPages : []);
        this.offline.set(r.offline as OfflineStats | null);
        this.loading.set(false);
        this.loadingOffline.set(false);
      },
      error: () => { this.loading.set(false); this.loadingOffline.set(false); },
    });

    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source(); void this.hideOffline();
      this.trigger$.next();
    });

    this.trigger$.next();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
