/**
 * ApmDashboardComponent  (selector: apm-dashboard)
 * Ported from App.jsx.
 *
 * Shell: sticky command bar + 7-tab layout.
 * Overview tab wired fully (KPI ribbon + API chart + Page chart).
 * Remaining tabs render "Coming Soon" placeholders for Phase B/C.
 *
 * Styling: ViewEncapsulation.None + imports apm-dashboard.css globally.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, output, computed, signal, effect, OnInit, OnDestroy,
  PLATFORM_ID, ElementRef, viewChild,
} from '@angular/core';
import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Subject, interval } from 'rxjs';
import { switchMap, debounceTime, takeUntil, startWith } from 'rxjs/operators';

import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { APM_DASHBOARD_CONFIG, ApmDashboardSourceOption } from '../data/apm-dashboard.config';
import {
  PerformanceMetrics, DateRange, DashboardPageOption, Role, User,
} from '../models/apm-dashboard.models';

import { ApmKpiRibbonComponent } from './apm-kpi-ribbon.component';
import { ApmApiPerformanceChartComponent } from './apm-api-performance-chart.component';
import { ApmPagePerformanceChartComponent } from './apm-page-performance-chart.component';
import { ApmPerformanceTableComponent } from './apm-performance-table.component';
import { ApmErrorAnalysisChartComponent } from './apm-error-analysis-chart.component';
import { ApmErrorFingerprintsTableComponent } from './apm-error-fingerprints-table.component';
import { ApmNetworkWaterfallChartComponent } from '../charts/apm-network-waterfall-chart.component';
import { ApmTimeSeriesChartComponent } from './apm-time-series-chart.component';
import { ApmPercentilesWidgetComponent } from './apm-percentiles-widget.component';
import { ApmReleaseComparisonTableComponent } from './apm-release-comparison-table.component';
import { ApmMobileTabComponent } from './apm-mobile-tab.component';
import { ApmNetworkBreakdownChartComponent } from './apm-network-breakdown-chart.component';
import { ApmUserExperienceTabComponent } from './apm-user-experience-tab.component';
import { ApmAppsComparisonChartComponent } from './apm-apps-comparison-chart.component';

import { toLocalISOString, getEndOfDay, formatAgo } from '../utils/date-utils';

type TabId = 'overview' | 'apis' | 'pages' | 'mobile' | 'ux' | 'trends' | 'errors' | 'apps';

interface Preset { label: string; full: string; hours?: number; days?: number; }
const PRESETS: Preset[] = [
  { label: '1h',  full: 'Last Hour',    hours: 1  },
  { label: '24h', full: 'Last 24 hours', hours: 24 },
  { label: '7d',  full: 'Last 7 days',  days: 7   },
  { label: '30d', full: 'Last 30 days', days: 30  },
];

@Component({
  selector: 'apm-dashboard',
  standalone: true,
  imports: [
    ApmKpiRibbonComponent,
    ApmApiPerformanceChartComponent,
    ApmPagePerformanceChartComponent,
    ApmPerformanceTableComponent,
    ApmErrorAnalysisChartComponent,
    ApmErrorFingerprintsTableComponent,
    ApmNetworkWaterfallChartComponent,
    ApmTimeSeriesChartComponent,
    ApmPercentilesWidgetComponent,
    ApmReleaseComparisonTableComponent,
    ApmMobileTabComponent,
    ApmNetworkBreakdownChartComponent,
    ApmUserExperienceTabComponent,
    ApmAppsComparisonChartComponent,
    NgTemplateOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../styles/apm-dashboard.css'],
  template: `
<div class="apm-dashboard-root">

  <!-- ===== Command bar ===== -->
  <div class="pd-commandbar">

    <!-- Date presets -->
    <div class="pd-commandbar__group">
      <div class="pd-segment" role="tablist" aria-label="Date range presets">
        @for (preset of presets; track preset.label) {
          <button
            type="button"
            [title]="preset.full"
            [class]="'pd-segment__btn' + (isPresetActive(preset) ? ' pd-segment__btn--active' : '')"
            (click)="applyPreset(preset)"
          >{{ preset.label }}</button>
        }
      </div>
    </div>

    <!-- Date range picker (inline, no external dependency) -->
    <div class="pd-commandbar__group">
      <div style="position:relative">
        <button type="button" class="pd-field" (click)="toggleDatePicker()">
          <svg class="pd-field__icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span class="pd-field__value">
            @if (dateRange().from && dateRange().to) {
              {{ fmtDate(dateRange().from!) }} – {{ fmtDate(dateRange().to!) }}
            } @else {
              Pick date range
            }
          </span>
          <svg class="pd-field__icon" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        @if (datePickerOpen()) {
          <div class="apm-date-picker-popover" (click)="$event.stopPropagation()">
            <div style="display:flex;gap:24px;padding:16px">
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--pd-text-muted);margin-bottom:8px">Start</div>
                <input
                  type="date"
                  class="pd-field"
                  style="width:140px;height:34px;cursor:text"
                  [value]="dateInputFrom()"
                  (change)="onFromChange($event)"
                />
              </div>
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--pd-text-muted);margin-bottom:8px">End</div>
                <input
                  type="date"
                  class="pd-field"
                  style="width:140px;height:34px;cursor:text"
                  [value]="dateInputTo()"
                  (change)="onToChange($event)"
                />
              </div>
            </div>
            <div style="padding:0 16px 12px;display:flex;gap:8px;justify-content:flex-end">
              <button type="button" class="pd-field" style="font-size:12px" (click)="clearDateRange()">Clear</button>
              <button type="button" class="pd-field" style="font-size:12px;border-color:var(--pd-status-info);color:var(--pd-status-info)" (click)="datePickerOpen.set(false)">Apply</button>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Filters: Source → Role → User → Page -->
    <div class="pd-commandbar__group">
      <!-- Source -->
      <div style="position:relative">
        <select class="pd-field pd-field--select" [value]="selectedSource()" (change)="onSourceChange($event)">
          @for (opt of sourceOptions(); track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>
        <span class="pd-field__icon" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </span>
      </div>

      <!-- Role (only if roles provided) -->
      @if (roles().length > 0 || rolesFromApi().length > 0) {
        <div style="position:relative">
          <select class="pd-field pd-field--select" [value]="selectedRole()" (change)="onRoleChange($event)">
            <option value="">All Roles</option>
            @for (role of allRoles(); track role.roleMasterId) {
              <option [value]="role.roleMasterId">{{ role.roleName }}</option>
            }
          </select>
          <span class="pd-field__icon" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </span>
        </div>
      }

      <!-- User multi-select (only if users provided or role is selected) -->
      @if (allUsers().length > 0) {
        <div style="position:relative" #userDropdownWrap>
          <button type="button" class="pd-field" (click)="toggleUserDropdown()" [title]="userButtonTitle()">
            <span class="pd-field__value">{{ userButtonLabel() }}</span>
            <svg class="pd-field__icon" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          @if (userDropdownOpen()) {
            <div class="pd-user-dropdown">
              <div class="pd-user-dropdown__scroll">
                <div class="pd-user-dropdown__header">
                  <input type="checkbox" id="apm-all-users"
                    [checked]="selectedUsers().length === allUsers().length && allUsers().length > 0"
                    (change)="toggleAllUsers($event)" />
                  <label for="apm-all-users" style="font-size:13px;font-weight:500;cursor:pointer">All Users</label>
                </div>
                @for (user of allUsers(); track user.loginId) {
                  <div class="pd-user-dropdown__row">
                    <input type="checkbox" [id]="'apm-u-' + user.loginId"
                      [checked]="selectedUsers().includes(user.loginId)"
                      (change)="toggleUser(user.loginId, $event)" />
                    <label [for]="'apm-u-' + user.loginId" style="font-size:13px;cursor:pointer">{{ user.userName }}</label>
                  </div>
                }
              </div>
              @if (selectedUsers().length > 0) {
                <div class="pd-user-dropdown__footer">
                  <button type="button" class="pd-segment__btn pd-segment__btn--active" style="font-size:11px" (click)="clearUsers()">Clear</button>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Page (Portal-only) -->
      @if (selectedSource() === 'Portal' && pageOptions().length > 0) {
        <div style="position:relative">
          <select class="pd-field pd-field--select" [value]="selectedPage()" (change)="onPageChange($event)">
            <option value="">All Pages</option>
            @for (page of pageOptions(); track page.value) {
              <option [value]="page.value">{{ page.label }}</option>
            }
          </select>
          <span class="pd-field__icon" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
            </svg>
          </span>
        </div>
      }
    </div>

    <div class="pd-commandbar__spacer"></div>

    <!-- Meta + Refresh -->
    <div class="pd-commandbar__group">
      <span class="pd-meta">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        Updated {{ freshnessLabel() }}
      </span>
      <button type="button" class="pd-field" (click)="refresh()" title="Refresh">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <span style="font-size:12px;font-weight:500">Refresh</span>
      </button>
    </div>
  </div>

  <!-- ===== Page body ===== -->
  <div class="apm-dashboard-body">

    @if (metricsLoading()) {
      <div class="pd-spinner-wrap" style="height:80px">
        <div class="pd-spinner"></div>
      </div>
    }

    <!-- KPI ribbon (always visible once loaded, or skeleton) -->
    <apm-kpi-ribbon [metrics]="metrics()" />

    <!-- ===== Tabs nav ===== -->
    <div class="pd-tabs-nav" role="tablist">
      <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'overview'" (click)="activeTab.set('overview')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Overview
      </button>
      <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'apis'" (click)="activeTab.set('apis')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        API
      </button>
      <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'pages'" (click)="activeTab.set('pages')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        Pages
      </button>
      @if (selectedSource() !== 'Portal') {
        <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'mobile'" (click)="activeTab.set('mobile')">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
            <line x1="12" y1="18" x2="12.01" y2="18"/>
          </svg>
          Mobile
        </button>
      }
      <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'ux'" (click)="activeTab.set('ux')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
        </svg>
        UX
      </button>
      <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'trends'" (click)="activeTab.set('trends')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
        Trends
      </button>
      <button type="button" role="tab" class="pd-tab-pill" [class.pd-tab-pill--active]="activeTab() === 'errors'" (click)="activeTab.set('errors')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Errors
      </button>
    </div>

    <!-- ===== Tab panels ===== -->

    <!-- Overview -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'overview' ? ' pd-tab-panel--active' : '')">
      <div class="pd-overview-grid">
        <apm-api-performance-chart
          [dateRange]="dateRange()"
          [detailed]="false"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
          [limit]="10"
        />
        <apm-page-performance-chart
          [dateRange]="dateRange()"
          [detailed]="false"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
      </div>
    </div>

    <!-- API (detailed) -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'apis' ? ' pd-tab-panel--active' : '')">
      <div style="display:flex;flex-direction:column;gap:16px">
        <apm-api-performance-chart
          [dateRange]="dateRange()"
          [detailed]="true"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
          [limit]="20"
        />
        <apm-network-waterfall-chart
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
        <apm-performance-table
          type="api"
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
      </div>
    </div>

    <!-- Pages (detailed) -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'pages' ? ' pd-tab-panel--active' : '')">
      <div style="display:flex;flex-direction:column;gap:16px">
        <apm-page-performance-chart
          [dateRange]="dateRange()"
          [detailed]="true"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
        <apm-performance-table
          type="page"
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
      </div>
    </div>

    <!-- Mobile (only when source !== Portal) -->
    @if (selectedSource() !== 'Portal') {
      <div [class]="'pd-tab-panel' + (activeTab() === 'mobile' ? ' pd-tab-panel--active' : '')">
        <div style="display:flex;flex-direction:column;gap:16px">
          <apm-mobile-tab
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
          <apm-network-breakdown-chart
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
        </div>
      </div>
    }

    <!-- UX -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'ux' ? ' pd-tab-panel--active' : '')">
      <apm-user-experience-tab
        [dateRange]="dateRange()"
        [roleId]="selectedRole()"
        [userId]="userIdParam()"
        [pageUrl]="selectedPage()"
        [source]="selectedSource()"
        [hideOffline]="selectedSource() === 'Portal'"
      />
    </div>

    <!-- Trends -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'trends' ? ' pd-tab-panel--active' : '')">
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- 4 time-series charts: page_load_time, api_response_time, fcp, inp -->
        <div class="pd-overview-grid">
          <apm-time-series-chart
            metric="page_load_time"
            title="Page Load Time"
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
          <apm-time-series-chart
            metric="api_response_time"
            title="API Response Time"
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
        </div>
        <div class="pd-overview-grid">
          <apm-time-series-chart
            metric="fcp"
            title="First Contentful Paint"
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
          <apm-time-series-chart
            metric="inp"
            title="Interaction to Next Paint"
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
        </div>
        <!-- Percentiles widget -->
        <apm-percentiles-widget
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
        <!-- Release comparison (mobile sources only) -->
        @if (selectedSource() !== 'Portal') {
          <apm-release-comparison-table
            [dateRange]="dateRange()"
            [roleId]="selectedRole()"
            [userId]="userIdParam()"
            [pageUrl]="selectedPage()"
            [source]="selectedSource()"
          />
        }
      </div>
    </div>

    <!-- Apps (trigger button is intentionally hidden — matches React App.jsx) -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'apps' ? ' pd-tab-panel--active' : '')">
      <apm-apps-comparison-chart
        [dateRange]="dateRange()"
        [roleId]="selectedRole()"
        [userId]="userIdParam()"
        [pageUrl]="selectedPage()"
        [source]="selectedSource()"
      />
    </div>

    <!-- Errors (live) -->
    <div [class]="'pd-tab-panel' + (activeTab() === 'errors' ? ' pd-tab-panel--active' : '')">
      <div style="display:flex;flex-direction:column;gap:16px">
        <apm-error-analysis-chart
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
        <apm-error-fingerprints-table
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
        <apm-performance-table
          type="error"
          [dateRange]="dateRange()"
          [roleId]="selectedRole()"
          [userId]="userIdParam()"
          [pageUrl]="selectedPage()"
          [source]="selectedSource()"
        />
      </div>
    </div>

  </div><!-- /apm-dashboard-body -->
</div><!-- /apm-dashboard-root -->
  `,
  styles: [`
    .apm-dashboard-body {
      padding: 20px 24px 32px;
    }
    .apm-date-picker-popover {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 50;
      background: var(--pd-surface);
      border: 1px solid var(--pd-border);
      border-radius: var(--pd-radius);
      box-shadow: 0 8px 24px rgba(15,23,42,0.12);
      min-width: 320px;
    }
    input[type="date"].pd-field {
      cursor: text;
      appearance: auto;
      -webkit-appearance: auto;
    }
  `],
})
export class ApmDashboardComponent implements OnInit, OnDestroy {
  // ---- optional host-provided filter data ----
  /** Pre-fetched roles array; if omitted the dashboard fetches from API. */
  roles       = input<Role[]>([]);
  /** Pre-fetched users for the current role; if omitted dashboard fetches from API on role change. */
  users       = input<User[]>([]);
  /** Page options shown in the Portal page filter. If omitted, page filter is hidden. */
  pageOptions = input<DashboardPageOption[]>([]);

  /** Emits the roleMasterId when role changes so host can load users. */
  roleChange  = output<string>();

  // ---- deps ----
  private dataProvider = inject(ApmDashboardDataProvider);
  private config = inject(APM_DASHBOARD_CONFIG);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private destroy$ = new Subject<void>();
  private metricsTrigger$ = new Subject<void>();
  private refreshTrigger$ = new Subject<void>();

  // ---- filter state ----
  readonly presets = PRESETS;

  dateRange     = signal<DateRange>({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() });
  selectedSource = signal<string>(this.config.defaultSource ?? 'Portal');
  selectedRole  = signal<string>('');
  selectedUsers = signal<string[]>([]);
  selectedPage  = signal<string>('');
  activeTab     = signal<TabId>('overview');
  datePickerOpen = signal(false);
  userDropdownOpen = signal(false);

  // ---- API-loaded state ----
  metrics        = signal<PerformanceMetrics | null>(null);
  metricsLoading = signal(true);
  rolesFromApi   = signal<Role[]>([]);
  usersFromApi   = signal<User[]>([]);
  lastUpdated    = signal<Date | null>(null);
  freshnessLabel = signal<string>('—');

  // ---- derived ----
  sourceOptions = computed((): ApmDashboardSourceOption[] => this.config.sources);
  allRoles      = computed(() => (this.roles().length ? this.roles() : this.rolesFromApi()));
  allUsers      = computed(() => (this.users().length ? this.users() : this.usersFromApi()));

  userIdParam = computed(() => {
    const sel = this.selectedUsers();
    const all = this.allUsers();
    return sel.length > 0 && sel.length !== all.length ? sel.join(',') : undefined;
  });

  userButtonLabel = computed(() => {
    const sel = this.selectedUsers();
    const all = this.allUsers();
    if (sel.length === 0 || sel.length === all.length) return 'All Users';
    return `${sel.length} user${sel.length > 1 ? 's' : ''}`;
  });

  userButtonTitle = computed(() => {
    const sel = this.selectedUsers();
    const all = this.allUsers();
    if (sel.length === 0 || sel.length === all.length) return 'All Users';
    return sel.map(id => all.find(u => u.loginId === id)?.userName).filter(Boolean).join(', ');
  });

  dateInputFrom = computed(() => {
    const d = this.dateRange().from;
    return d ? d.toISOString().slice(0, 10) : '';
  });
  dateInputTo = computed(() => {
    const d = this.dateRange().to;
    return d ? d.toISOString().slice(0, 10) : '';
  });

  ngOnInit(): void {
    if (!this.isBrowser) return;

    // Metrics fetch (debounced switchMap)
    this.metricsTrigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.metricsLoading.set(true);
        return this.dataProvider.getPerformanceMetrics(this.buildMetricsFilter());
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: m  => { this.metrics.set(m); this.metricsLoading.set(false); this.lastUpdated.set(new Date()); },
      error: () => { this.metricsLoading.set(false); },
    });

    // Watch filter signals → trigger metrics fetch
    effect(() => {
      void this.dateRange(); void this.selectedRole(); void this.selectedUsers();
      void this.selectedPage(); void this.selectedSource();
      this.metricsTrigger$.next();
    }, { injector: undefined as any });

    // Roles fetch (only if host did not supply roles)
    if (!this.roles().length) {
      this.dataProvider.getRoles().pipe(takeUntil(this.destroy$))
        .subscribe({ next: r => this.rolesFromApi.set(r ?? []), error: () => {} });
    }

    // Freshness label every 10 s
    interval(10_000).pipe(startWith(0), takeUntil(this.destroy$))
      .subscribe(() => this.freshnessLabel.set(formatAgo(this.lastUpdated())));

    // Initial fetch
    this.metricsTrigger$.next();
  }

  // ---- filter builders ----
  private buildMetricsFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = {};
    if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
    if (this.selectedRole() && this.selectedRole() !== 'all') f.roleId = this.selectedRole();
    const uid = this.userIdParam();
    if (uid) f.userId = uid;
    if (this.selectedPage() && this.selectedPage() !== 'all') f.pageUrl = this.selectedPage();
    if (this.selectedSource()) f.source = this.selectedSource();
    return f;
  }

  // ---- event handlers ----
  applyPreset(preset: Preset): void {
    const to = new Date();
    const from = new Date();
    if (preset.hours) from.setHours(from.getHours() - preset.hours);
    if (preset.days)  from.setDate(from.getDate() - preset.days);
    this.dateRange.set({ from, to });
  }

  isPresetActive(preset: Preset): boolean {
    const dr = this.dateRange();
    if (!dr.from || !dr.to) return false;
    const diff = Date.now() - dr.from.getTime();
    const tol  = 5 * 60 * 1000;
    if (preset.hours) return Math.abs(diff - preset.hours * 3600 * 1000) < tol;
    if (preset.days)  return Math.abs(diff - preset.days * 86400 * 1000) < tol;
    return false;
  }

  toggleDatePicker(): void { this.datePickerOpen.update(v => !v); }

  onFromChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (!val) return;
    const d = new Date(val + 'T00:00:00');
    this.dateRange.update(dr => ({ ...dr, from: d }));
  }

  onToChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (!val) return;
    const d = getEndOfDay(new Date(val + 'T00:00:00'));
    this.dateRange.update(dr => ({ ...dr, to: d }));
  }

  clearDateRange(): void {
    this.dateRange.set({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() });
    this.datePickerOpen.set(false);
  }

  onSourceChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedSource.set(val);
    if (val !== 'Portal') this.selectedPage.set('');
    // Switch away from Mobile tab if source is now Portal
    if (val === 'Portal' && this.activeTab() === 'mobile') this.activeTab.set('overview');
  }

  onRoleChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedRole.set(val);
    this.selectedUsers.set([]);
    this.roleChange.emit(val);
    // Fetch users for role (if host did not supply users)
    if (val && !this.users().length) {
      this.dataProvider.getUsersByRole(val).pipe(takeUntil(this.destroy$))
        .subscribe({ next: u => this.usersFromApi.set(u ?? []), error: () => this.usersFromApi.set([]) });
    } else {
      this.usersFromApi.set([]);
    }
  }

  onPageChange(event: Event): void {
    this.selectedPage.set((event.target as HTMLSelectElement).value);
  }

  toggleUserDropdown(): void { this.userDropdownOpen.update(v => !v); }

  toggleAllUsers(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedUsers.set(checked ? this.allUsers().map(u => u.loginId) : []);
  }

  toggleUser(loginId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedUsers.update(sel =>
      checked ? [...sel, loginId] : sel.filter(id => id !== loginId)
    );
  }

  clearUsers(): void { this.selectedUsers.set([]); }

  refresh(): void { this.metricsTrigger$.next(); }

  fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
