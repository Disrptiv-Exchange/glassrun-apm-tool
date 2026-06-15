/**
 * ApmPerformanceTableComponent
 * Ported from PerformanceTable.jsx — shared, sortable/filterable table
 * used by API tab, Pages tab, and Errors tab.
 *
 * `type` input ('api' | 'page' | 'error') controls:
 *   - which provider method is called
 *   - which columns are shown
 *
 * Features: search, sort (click header), pagination (10 per page).
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy,
} from '@angular/core';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import {
  ApiPerformanceStats, PagePerformanceStats, ErrorAnalysis, DateRange,
} from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay } from '../utils/date-utils';

export type TableType = 'api' | 'page' | 'error';

type AnyRow = ApiPerformanceStats | PagePerformanceStats | ErrorAnalysis;

const PAGE_SIZE = 10;

@Component({
  selector: 'apm-performance-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/>
          </svg>
          {{ tableTitle() }}
        </h3>
        <p class="pd-card-desc">Detailed performance data with sorting and filtering</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else {
          <!-- Controls -->
          <div class="apm-tbl__controls">
            <div class="apm-tbl__search-wrap">
              <svg class="apm-tbl__search-icon" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                class="pd-field apm-tbl__search"
                type="search"
                placeholder="Search…"
                [value]="searchTerm()"
                (input)="onSearch($event)"
              />
            </div>
          </div>

          <!-- Table -->
          <div class="apm-tbl__wrap">
            <table class="apm-tbl">
              <thead>
                <tr>
                  @switch (type()) {
                    @case ('api') {
                      <th class="apm-tbl__th" (click)="sort('apiUrl')">API Endpoint {{ sortIcon('apiUrl') }}</th>
                      <th class="apm-tbl__th">Method</th>
                      <th class="apm-tbl__th" (click)="sort('avgDuration')">Avg Duration {{ sortIcon('avgDuration') }}</th>
                      <th class="apm-tbl__th" (click)="sort('callCount')">Calls {{ sortIcon('callCount') }}</th>
                      <th class="apm-tbl__th" (click)="sort('successRate')">Success Rate {{ sortIcon('successRate') }}</th>
                      <th class="apm-tbl__th">Range</th>
                    }
                    @case ('page') {
                      <th class="apm-tbl__th" (click)="sort('pageUrl')">Page {{ sortIcon('pageUrl') }}</th>
                      <th class="apm-tbl__th" (click)="sort('avgLoadTime')">Load Time {{ sortIcon('avgLoadTime') }}</th>
                      <th class="apm-tbl__th" (click)="sort('avgFcp')">FCP {{ sortIcon('avgFcp') }}</th>
                      <th class="apm-tbl__th" (click)="sort('avgLcp')">LCP {{ sortIcon('avgLcp') }}</th>
                      <th class="apm-tbl__th" (click)="sort('avgInp')">INP {{ sortIcon('avgInp') }}</th>
                      <th class="apm-tbl__th" (click)="sort('visitCount')">Visits {{ sortIcon('visitCount') }}</th>
                    }
                    @case ('error') {
                      <th class="apm-tbl__th" (click)="sort('statusCode')">Status Code {{ sortIcon('statusCode') }}</th>
                      <th class="apm-tbl__th" (click)="sort('apiUrl')">API Endpoint {{ sortIcon('apiUrl') }}</th>
                      <th class="apm-tbl__th" (click)="sort('count')">Error Count {{ sortIcon('count') }}</th>
                      <th class="apm-tbl__th" (click)="sort('percentage')">Percentage {{ sortIcon('percentage') }}</th>
                    }
                  }
                </tr>
              </thead>
              <tbody>
                @if (pageRows().length === 0) {
                  <tr>
                    <td [attr.colspan]="colCount()" class="apm-tbl__empty-cell">
                      {{ searchTerm() ? 'No results found for your search.' : 'No data available.' }}
                    </td>
                  </tr>
                } @else {
                  @for (row of pageRows(); track $index) {
                    <tr class="apm-tbl__row">
                      @switch (type()) {
                        @case ('api') {
                          <td class="apm-tbl__td">
                            <div class="apm-tbl__api-name">{{ apiName(asApi(row).apiUrl) }}</div>
                            <div class="apm-tbl__api-url">{{ asApi(row).apiUrl }}</div>
                          </td>
                          <td class="apm-tbl__td">
                            <span class="apm-tbl__badge">{{ asApi(row).apiMethod }}</span>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--num">
                            <span class="apm-tbl__dur" [style.color]="durColor(asApi(row).avgDuration)">
                              {{ fmtDur(asApi(row).avgDuration) }}
                            </span>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--num">{{ asApi(row).callCount }}</td>
                          <td class="apm-tbl__td">
                            <div class="apm-tbl__success">
                              <span class="apm-tbl__success-dot"
                                [style.background]="successDotColor(asApi(row).successRate)"></span>
                              {{ asApi(row).successRate?.toFixed(1) ?? 'N/A' }}%
                            </div>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--muted">
                            {{ fmtDur(asApi(row).minDuration) }} – {{ fmtDur(asApi(row).maxDuration) }}
                          </td>
                        }
                        @case ('page') {
                          <td class="apm-tbl__td">
                            <span class="apm-tbl__page-url">{{ asPage(row).pageUrl }}</span>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--num">
                            <span class="apm-tbl__dur" [style.color]="durColor(asPage(row).avgLoadTime)">
                              {{ fmtDur(asPage(row).avgLoadTime) }}
                            </span>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--num">{{ fmtDur(asPage(row).avgFcp) }}</td>
                          <td class="apm-tbl__td apm-tbl__td--num">{{ fmtDur(asPage(row).avgLcp) }}</td>
                          <td class="apm-tbl__td apm-tbl__td--num">{{ fmtDur(asPage(row).avgInp) }}</td>
                          <td class="apm-tbl__td apm-tbl__td--num">{{ asPage(row).visitCount }}</td>
                        }
                        @case ('error') {
                          <td class="apm-tbl__td">
                            <span class="apm-tbl__status-badge"
                              [style.border-color]="statusColor(asErr(row).statusCode)"
                              [style.color]="statusColor(asErr(row).statusCode)">
                              {{ asErr(row).statusCode }}
                            </span>
                          </td>
                          <td class="apm-tbl__td">
                            <div class="apm-tbl__api-name">{{ apiName(asErr(row).apiUrl) }}</div>
                            <div class="apm-tbl__api-url">{{ asErr(row).apiUrl }}</div>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--num">
                            <span class="apm-tbl__err-count">{{ asErr(row).count }}</span>
                          </td>
                          <td class="apm-tbl__td apm-tbl__td--num">{{ asErr(row).percentage?.toFixed(1) ?? 'N/A' }}%</td>
                        }
                      }
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          @if (totalPages() > 1) {
            <div class="apm-tbl__pager">
              <span class="apm-tbl__pager-info">
                Showing {{ pageStart() + 1 }}–{{ pageEnd() }} of {{ filteredRows().length }} results
              </span>
              <div class="apm-tbl__pager-btns">
                <button
                  type="button"
                  class="pd-field apm-tbl__pager-btn"
                  [disabled]="currentPage() === 1"
                  (click)="goPage(currentPage() - 1)"
                >Previous</button>
                @for (pg of pageRange(); track pg) {
                  <button
                    type="button"
                    class="pd-field apm-tbl__pager-btn"
                    [class.apm-tbl__pager-btn--active]="pg === currentPage()"
                    (click)="goPage(pg)"
                  >{{ pg }}</button>
                }
                <button
                  type="button"
                  class="pd-field apm-tbl__pager-btn"
                  [disabled]="currentPage() === totalPages()"
                  (click)="goPage(currentPage() + 1)"
                >Next</button>
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .apm-tbl__controls {
      display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
    }
    .apm-tbl__search-wrap {
      position: relative; flex: 1; max-width: 360px;
    }
    .apm-tbl__search-icon {
      position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
      color: #94a3b8; pointer-events: none;
    }
    .apm-tbl__search {
      width: 100%; padding-left: 32px !important; cursor: text;
      box-sizing: border-box;
    }
    .apm-tbl__wrap { overflow-x: auto; }
    .apm-tbl {
      width: 100%; border-collapse: collapse; font-size: 13px;
    }
    .apm-tbl__th {
      padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600;
      color: var(--pd-text-muted); border-bottom: 1px solid var(--pd-border);
      white-space: nowrap; cursor: pointer; user-select: none;
    }
    .apm-tbl__th:hover { color: var(--pd-text); }
    .apm-tbl__row:hover { background: var(--pd-surface-muted); }
    .apm-tbl__row:not(:last-child) td { border-bottom: 1px solid var(--pd-border); }
    .apm-tbl__td { padding: 10px 12px; vertical-align: middle; }
    .apm-tbl__td--num { text-align: right; font-variant-numeric: tabular-nums; }
    .apm-tbl__td--muted { font-size: 11px; color: var(--pd-text-muted); }
    .apm-tbl__api-name { font-weight: 500; color: var(--pd-text); }
    .apm-tbl__api-url  { font-size: 11px; color: var(--pd-text-muted); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .apm-tbl__page-url { font-weight: 500; color: var(--pd-text); }
    .apm-tbl__badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      border: 1px solid var(--pd-border); color: var(--pd-text-muted);
    }
    .apm-tbl__status-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;
      border: 1.5px solid; background: transparent;
    }
    .apm-tbl__dur { font-weight: 600; }
    .apm-tbl__success { display: flex; align-items: center; gap: 6px; }
    .apm-tbl__success-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .apm-tbl__err-count { font-weight: 600; }
    .apm-tbl__empty-cell {
      padding: 40px 12px; text-align: center; color: var(--pd-text-muted); font-size: 13px;
    }
    .apm-tbl__pager {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 16px; font-size: 12px; color: var(--pd-text-muted); flex-wrap: wrap; gap: 8px;
    }
    .apm-tbl__pager-btns { display: flex; gap: 4px; }
    .apm-tbl__pager-btn { min-width: 32px; justify-content: center; font-size: 12px; }
    .apm-tbl__pager-btn--active { background: var(--pd-text) !important; color: var(--pd-surface) !important; border-color: var(--pd-text) !important; }
    .apm-tbl__pager-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  `],
})
export class ApmPerformanceTableComponent implements OnDestroy {
  // inputs
  type      = input<TableType>('api');
  dateRange = input<DateRange>({ from: null, to: null });
  roleId    = input<string>('');
  userId    = input<string | undefined>(undefined);
  pageUrl   = input<string>('');
  source    = input<string>('Portal');

  // deps
  private dataProvider = inject(ApmDashboardDataProvider);
  private destroy$     = new Subject<void>();
  private trigger$     = new Subject<void>();

  // state
  loading     = signal(true);
  rawData     = signal<AnyRow[]>([]);
  searchTerm  = signal('');
  sortField   = signal('');
  sortDir     = signal<'asc' | 'desc'>('asc');
  currentPage = signal(1);

  // derived
  tableTitle = computed(() => {
    switch (this.type()) {
      case 'api':   return 'API Performance Details';
      case 'page':  return 'Page Performance Details';
      case 'error': return 'Error Details';
      default:      return 'Performance Data';
    }
  });

  colCount = computed(() => {
    switch (this.type()) {
      case 'api':   return 6;
      case 'page':  return 6;
      case 'error': return 4;
      default:      return 4;
    }
  });

  filteredRows = computed((): AnyRow[] => {
    const term = this.searchTerm().toLowerCase();
    const src  = this.rawData();
    const filtered = term
      ? src.filter(row => Object.values(row).join(' ').toLowerCase().includes(term))
      : src;

    const field = this.sortField();
    const dir   = this.sortDir();
    if (!field) return filtered;

    return [...filtered].sort((a, b) => {
      const av = (a as any)[field];
      const bv = (b as any)[field];
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av ?? '').toLowerCase();
      const bs = String(bv ?? '').toLowerCase();
      return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.filteredRows().length / PAGE_SIZE)));
  pageStart  = computed(() => (this.currentPage() - 1) * PAGE_SIZE);
  pageEnd    = computed(() => Math.min(this.pageStart() + PAGE_SIZE, this.filteredRows().length));
  pageRows   = computed(() => this.filteredRows().slice(this.pageStart(), this.pageEnd()));

  pageRange = computed((): number[] => {
    const total = this.totalPages();
    const cur   = this.currentPage();
    const range: number[] = [];
    const start = Math.max(1, cur - 2);
    const end   = Math.min(total, cur + 2);
    for (let i = start; i <= end; i++) range.push(i);
    return range;
  });

  // helpers
  asApi(row: AnyRow):  ApiPerformanceStats  { return row as ApiPerformanceStats;  }
  asPage(row: AnyRow): PagePerformanceStats  { return row as PagePerformanceStats; }
  asErr(row: AnyRow):  ErrorAnalysis        { return row as ErrorAnalysis;         }

  apiName(url: string): string {
    if (!url) return 'Unknown';
    const parts = url.split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  }

  fmtDur(ms: number | undefined): string {
    if (ms == null || isNaN(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  durColor(ms: number | undefined): string {
    if (ms == null) return '';
    if (ms < 500)  return '#6e8d5b';
    if (ms < 1000) return '#b45309';
    return '#be123c';
  }

  successDotColor(rate: number | undefined): string {
    if (rate == null) return '#8d99ae';
    if (rate > 95) return '#10b981';
    if (rate > 90) return '#f59e0b';
    return '#f43f5e';
  }

  statusColor(code: number): string {
    if (code >= 500) return '#ef476f';
    if (code >= 400) return '#8d99ae';
    return '#f4a261';
  }

  sortIcon(field: string): string {
    if (this.sortField() !== field) return '⇅';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }

  sort(field: string): void {
    if (this.sortField() === field) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDir.set('asc');
    }
    this.currentPage.set(1);
  }

  onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }

  goPage(n: number): void {
    this.currentPage.set(Math.max(1, Math.min(this.totalPages(), n)));
  }

  private buildFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = { limit: 20 };
    if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
    if (this.roleId() && this.roleId() !== 'all') f.roleId = this.roleId();
    if (this.userId() && this.userId() !== 'all') f.userId = this.userId();
    if (this.pageUrl() && this.pageUrl() !== 'all') f.pageUrl = this.pageUrl();
    if (this.source() && this.source() !== 'all') f.source = this.source();
    return f;
  }

  private fetchData() {
    const t = this.type();
    const f = this.buildFilter();
    this.loading.set(true);
    let obs;
    if (t === 'api')   obs = this.dataProvider.getApiPerformanceStats(f);
    else if (t === 'page')  obs = this.dataProvider.getPagePerformanceStats(f);
    else                    obs = this.dataProvider.getErrorAnalysis(f);
    return obs;
  }

  constructor() {
    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => this.fetchData()),
      takeUntil(this.destroy$),
    ).subscribe({
      next: data => { this.rawData.set((data as AnyRow[]) ?? []); this.loading.set(false); this.currentPage.set(1); },
      error: ()  => { this.rawData.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.type(); void this.dateRange(); void this.roleId();
      void this.userId(); void this.pageUrl(); void this.source();
      this.trigger$.next();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
