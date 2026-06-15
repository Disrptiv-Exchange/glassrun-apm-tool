/**
 * ApmMobileTabComponent  (selector: apm-mobile-tab)
 * Ported from MobileTab.jsx (GR-9408).
 *
 * Shows:
 *   1. Cold Start Performance  (getColdStartStats)
 *   2. Capacitor Plugin Performance  (getPluginPerformance)
 *   3. Performance by Battery Level + Storage  (getBatteryStorageCorrelation)
 *   4. Device & OS Breakdown  (getDeviceBreakdown)
 *
 * NetworkBreakdownChart is a separate component rendered adjacent in the shell.
 * Each API call debounced 300 ms, cancels in-flight with switchMap.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, effect, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, forkJoin } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import {
  DateRange, ColdStartStats, PluginPerformance,
  BatteryStorageCorrelation, DeviceBreakdown,
} from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';
import { ApmLineChartComponent } from '../charts/apm-line-chart.component';
import { ApmGroupedBarChartComponent, GroupedBarSeries } from '../charts/apm-grouped-bar-chart.component';

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
  selector: 'apm-mobile-tab',
  standalone: true,
  imports: [ApmLineChartComponent, ApmGroupedBarChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div style="display:flex;flex-direction:column;gap:16px">

      <!-- 1. Cold Start -->
      <div class="pd-card">
        <div class="pd-card-header">
          <h3 class="pd-card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M4.5 16.5c-1.5 1.5-2 4-2 4s2.5-.5 4-2c.87-.87 1.28-2.07 1-2.84-.28-.77-1.13-1.17-2-1.16zM12 15l-3-3"/>
              <path d="M15 9c0 .88-.18 1.73-.5 2.5-.32.77-.82 1.43-1.5 2-.68.57-1.46.97-2.5 1.17"/>
              <path d="M9 12c0-.88.18-1.73.5-2.5.32-.77.82-1.43 1.5-2C11.68 7 12.46 6.6 13.5 6.4"/>
              <circle cx="17" cy="7" r="4"/>
            </svg>
            Cold Start Performance
          </h3>
          <p class="pd-card-desc">Time from app launch to interactive screen</p>
        </div>
        <div class="pd-card-body">
          @if (loadingColdStart()) {
            <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
          } @else if (!coldStart() || coldStart()!.totalColdStarts === 0) {
            <div class="pd-empty" style="height:100px">
              <div class="pd-empty__title">No cold start data in the selected period.</div>
            </div>
          } @else {
            <!-- KPI row -->
            <div class="apm-mobile__kpi-row">
              <div class="apm-mobile__kpi">
                <div class="apm-mobile__kpi-label">Total Cold Starts</div>
                <div class="apm-mobile__kpi-val">{{ coldStart()!.totalColdStarts.toLocaleString() }}</div>
              </div>
              <div class="apm-mobile__kpi">
                <div class="apm-mobile__kpi-label">Avg</div>
                <div class="apm-mobile__kpi-val">{{ fmtMs(coldStart()!.avgColdStartMs) }}</div>
              </div>
              <div class="apm-mobile__kpi">
                <div class="apm-mobile__kpi-label">Min</div>
                <div class="apm-mobile__kpi-val">{{ fmtMs(coldStart()!.minColdStartMs) }}</div>
              </div>
              <div class="apm-mobile__kpi">
                <div class="apm-mobile__kpi-label">Max</div>
                <div class="apm-mobile__kpi-val">{{ fmtMs(coldStart()!.maxColdStartMs) }}</div>
              </div>
            </div>
            <!-- Trend chart -->
            @if (coldStartTrendData().length > 0) {
              <div style="margin-top:16px">
                <apm-line-chart
                  [data]="coldStartTrendData()"
                  xKey="date"
                  valueKey="ColdStart"
                  color="#8b5cf6"
                  [height]="220"
                  [valueFormatFn]="fmtMs"
                  [xFormatFn]="fmtDate"
                  [xFullFormatFn]="fmtDate"
                />
              </div>
            }
            <!-- By app version table -->
            @if (coldStart()!.byAppVersion?.length) {
              <div style="margin-top:20px">
                <div style="font-size:13px;font-weight:600;margin-bottom:8px">By App Version</div>
                <div class="apm-tbl__wrap">
                  <table class="apm-tbl">
                    <thead>
                      <tr>
                        <th class="apm-tbl__th">App</th>
                        <th class="apm-tbl__th">Version</th>
                        <th class="apm-tbl__th">Count</th>
                        <th class="apm-tbl__th">Avg Cold Start</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of coldStart()!.byAppVersion; track r.appVersion) {
                        <tr class="apm-tbl__row">
                          <td class="apm-tbl__td">{{ r.appName }}</td>
                          <td class="apm-tbl__td"><span class="apm-tbl__badge">{{ r.appVersion }}</span></td>
                          <td class="apm-tbl__td">{{ r.count }}</td>
                          <td class="apm-tbl__td">{{ fmtMs(r.avgColdStartMs) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          }
        </div>
      </div>

      <!-- 2. Plugin Performance -->
      <div class="pd-card">
        <div class="pd-card-header">
          <h3 class="pd-card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Capacitor Plugin Performance
          </h3>
          <p class="pd-card-desc">Native bridge call timing</p>
        </div>
        <div class="pd-card-body">
          @if (loadingPlugin()) {
            <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
          } @else if (!plugin() || plugin()!.totalCalls === 0) {
            <div class="pd-empty" style="height:80px">
              <div class="pd-empty__title">No plugin call data.</div>
            </div>
          } @else {
            <div class="apm-mobile__kpi-row" style="margin-bottom:16px">
              <div class="apm-mobile__kpi">
                <div class="apm-mobile__kpi-label">Total Plugin Calls</div>
                <div class="apm-mobile__kpi-val">{{ plugin()!.totalCalls.toLocaleString() }}</div>
              </div>
              <div class="apm-mobile__kpi">
                <div class="apm-mobile__kpi-label">Avg Duration</div>
                <div class="apm-mobile__kpi-val">{{ fmtMs(plugin()!.avgDurationMs) }}</div>
              </div>
            </div>
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">Slowest Plugin Methods</div>
            <div class="apm-tbl__wrap">
              <table class="apm-tbl">
                <thead>
                  <tr>
                    <th class="apm-tbl__th">Plugin</th>
                    <th class="apm-tbl__th">Method</th>
                    <th class="apm-tbl__th">Calls</th>
                    <th class="apm-tbl__th">Avg</th>
                    <th class="apm-tbl__th">Max</th>
                    <th class="apm-tbl__th">Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of plugin()!.slowest?.slice(0,15); track r.pluginName + r.pluginMethod) {
                    <tr class="apm-tbl__row">
                      <td class="apm-tbl__td" style="font-weight:600">{{ r.pluginName }}</td>
                      <td class="apm-tbl__td">{{ r.pluginMethod }}</td>
                      <td class="apm-tbl__td">{{ r.callCount }}</td>
                      <td class="apm-tbl__td">{{ fmtMs(r.avgDurationMs) }}</td>
                      <td class="apm-tbl__td">{{ fmtMs(r.maxDurationMs) }}</td>
                      <td class="apm-tbl__td">{{ fmtPct(r.successRate) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>

      <!-- 3. Battery & Storage correlation side by side -->
      <div class="pd-overview-grid">
        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="10" x2="23" y2="14"/>
                <rect x="3" y="8" width="10" height="8" rx="1" fill="currentColor" fill-opacity="0.3"/>
              </svg>
              Performance by Battery Level
            </h3>
          </div>
          <div class="pd-card-body">
            @if (loadingBattery()) {
              <div class="pd-spinner-wrap" style="height:120px"><div class="pd-spinner"></div></div>
            } @else if (!battery()?.byBatteryLevel?.length) {
              <div class="pd-empty" style="height:80px"><div class="pd-empty__title">No battery data.</div></div>
            } @else {
              <apm-grouped-bar-chart
                [data]="batteryLevelData()"
                [series]="batteryStorageSeries"
                [height]="220"
                [yLabelFn]="fmtMs"
              />
            }
          </div>
        </div>

        <div class="pd-card">
          <div class="pd-card-header">
            <h3 class="pd-card-title">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              </svg>
              Performance by Storage
            </h3>
          </div>
          <div class="pd-card-body">
            @if (loadingBattery()) {
              <div class="pd-spinner-wrap" style="height:120px"><div class="pd-spinner"></div></div>
            } @else if (!battery()?.byStorage?.length) {
              <div class="pd-empty" style="height:80px"><div class="pd-empty__title">No storage data.</div></div>
            } @else {
              <apm-grouped-bar-chart
                [data]="storageData()"
                [series]="storageSeriesColors"
                [height]="220"
                [yLabelFn]="fmtMs"
              />
            }
          </div>
        </div>
      </div>

      <!-- 4. Device & OS breakdown -->
      <div class="pd-card">
        <div class="pd-card-header">
          <h3 class="pd-card-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8m-4-4v4"/>
            </svg>
            Device &amp; OS Breakdown
          </h3>
          <p class="pd-card-desc">Performance by device model, manufacturer, and OS version</p>
        </div>
        <div class="pd-card-body">
          @if (loadingDevice()) {
            <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
          } @else if (!device()) {
            <div class="pd-empty" style="height:80px"><div class="pd-empty__title">No device data.</div></div>
          } @else {
            <div class="pd-overview-grid">
              <!-- Top Devices -->
              <div>
                <div style="font-size:13px;font-weight:600;margin-bottom:8px">Top Devices</div>
                <div class="apm-tbl__wrap">
                  <table class="apm-tbl">
                    <thead>
                      <tr>
                        <th class="apm-tbl__th">Model</th>
                        <th class="apm-tbl__th">Count</th>
                        <th class="apm-tbl__th">Avg Page</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of device()!.byModel?.slice(0,10); track r.name) {
                        <tr class="apm-tbl__row">
                          <td class="apm-tbl__td">{{ r.name }}</td>
                          <td class="apm-tbl__td">{{ r.count }}</td>
                          <td class="apm-tbl__td">{{ fmtMs(r.avgPageLoadTime) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
              <!-- OS Versions -->
              <div>
                <div style="font-size:13px;font-weight:600;margin-bottom:8px">OS Versions</div>
                <div class="apm-tbl__wrap">
                  <table class="apm-tbl">
                    <thead>
                      <tr>
                        <th class="apm-tbl__th">Platform</th>
                        <th class="apm-tbl__th">Version</th>
                        <th class="apm-tbl__th">Count</th>
                        <th class="apm-tbl__th">Avg</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of device()!.byOsVersion?.slice(0,10); track r.platform+r.osVersion) {
                        <tr class="apm-tbl__row">
                          <td class="apm-tbl__td">{{ r.platform }}</td>
                          <td class="apm-tbl__td">{{ r.osVersion }}</td>
                          <td class="apm-tbl__td">{{ r.count }}</td>
                          <td class="apm-tbl__td">{{ fmtMs(r.avgPageLoadTime) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .apm-mobile__kpi-row { display:grid;grid-template-columns:repeat(4,1fr);gap:12px; }
    @media (max-width:600px) { .apm-mobile__kpi-row { grid-template-columns:repeat(2,1fr); } }
    .apm-mobile__kpi { padding:10px 12px;border-radius:8px;background:var(--pd-surface-muted);border:1px solid var(--pd-border); }
    .apm-mobile__kpi-label { font-size:11px;color:var(--pd-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px; }
    .apm-mobile__kpi-val { font-size:22px;font-weight:700;color:var(--pd-text);font-variant-numeric:tabular-nums; }
  `],
})
export class ApmMobileTabComponent implements OnDestroy {
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('');

  readonly fmtMs  = fmtMs;
  readonly fmtPct = fmtPct;

  coldStart      = signal<ColdStartStats | null>(null);
  plugin         = signal<PluginPerformance | null>(null);
  battery        = signal<BatteryStorageCorrelation | null>(null);
  device         = signal<DeviceBreakdown | null>(null);
  loadingColdStart = signal(true);
  loadingPlugin    = signal(true);
  loadingBattery   = signal(true);
  loadingDevice    = signal(true);

  readonly batteryStorageSeries: GroupedBarSeries[] = [
    { key: 'Avg API (ms)',  color: '#10b981', label: 'Avg API (ms)'  },
    { key: 'Avg Page (ms)', color: '#3b82f6', label: 'Avg Page (ms)' },
  ];
  readonly storageSeriesColors: GroupedBarSeries[] = [
    { key: 'Avg API (ms)',  color: '#f59e0b', label: 'Avg API (ms)'  },
    { key: 'Avg Page (ms)', color: '#8b5cf6', label: 'Avg Page (ms)' },
  ];

  coldStartTrendData = (() => {
    // computed lazily inside a getter to avoid referencing signal before init
    let _: any;
    return this.coldStartTrendDataComputed();
  });

  private coldStartTrendDataComputed() {
    const cs = this.coldStart();
    if (!cs?.trend?.length) return [];
    return cs.trend.map(t => ({
      date: t.date,
      ColdStart: Math.round(t.avgColdStartMs || 0),
    }));
  }

  batteryLevelData = () => {
    return (this.battery()?.byBatteryLevel ?? []).map(r => ({
      name: r.batteryBucket ?? '',
      'Avg API (ms)': Math.round(r.avgApiResponseTime || 0),
      'Avg Page (ms)': Math.round(r.avgPageLoadTime || 0),
    }));
  };

  storageData = () => {
    return (this.battery()?.byStorage ?? []).map(r => ({
      name: r.storageBucket ?? '',
      'Avg API (ms)': Math.round(r.avgApiResponseTime || 0),
      'Avg Page (ms)': Math.round(r.avgPageLoadTime || 0),
    }));
  };

  fmtDate = (x: string): string => x?.slice(0, 10) ?? '';

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
        this.loadingColdStart.set(true);
        this.loadingPlugin.set(true);
        this.loadingBattery.set(true);
        this.loadingDevice.set(true);
        const f = this.buildFilter();
        return forkJoin({
          coldStart: this.dp.getColdStartStats(f),
          plugin:    this.dp.getPluginPerformance({ ...f, limit: 20 }),
          battery:   this.dp.getBatteryStorageCorrelation(f),
          device:    this.dp.getDeviceBreakdown(f),
        });
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: r => {
        this.coldStart.set(r.coldStart);  this.loadingColdStart.set(false);
        this.plugin.set(r.plugin);        this.loadingPlugin.set(false);
        this.battery.set(r.battery);      this.loadingBattery.set(false);
        this.device.set(r.device);        this.loadingDevice.set(false);
      },
      error: () => {
        this.loadingColdStart.set(false); this.loadingPlugin.set(false);
        this.loadingBattery.set(false);   this.loadingDevice.set(false);
      },
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
