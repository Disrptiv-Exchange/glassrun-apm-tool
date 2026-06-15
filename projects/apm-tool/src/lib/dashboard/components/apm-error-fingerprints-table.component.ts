/**
 * ApmErrorFingerprintsTableComponent
 * Ported from ErrorFingerprintsTable.jsx (GR-9408).
 *
 * Displays UI error groups (fingerprints) with click-through to a
 * detail modal showing recent occurrences + breadcrumbs.
 *
 * Modal is rendered inline (position:fixed overlay) — no CDK dependency.
 * All breadcrumbs are parsed from the JSON string stored in
 * ErrorOccurrence.breadcrumbs.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation,
  inject, input, signal, computed, effect, OnDestroy,
} from '@angular/core';
import { Subject } from 'rxjs';
import { switchMap, debounceTime, takeUntil } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import {
  ErrorFingerprintRow, ErrorOccurrence, DateRange,
} from '../models/apm-dashboard.models';
import { toLocalISOString, getEndOfDay, formatAgo } from '../utils/date-utils';

interface ParsedBreadcrumb {
  category: string;
  message:  string;
}

@Component({
  selector: 'apm-error-fingerprints-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- Main card -->
    <div class="pd-card">
      <div class="pd-card-header">
        <h3 class="pd-card-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
          </svg>
          UI Error Groups
        </h3>
        <p class="pd-card-desc">Grouped by fingerprint — click a row to see occurrences &amp; breadcrumbs</p>
      </div>
      <div class="pd-card-body">
        @if (loading()) {
          <div class="pd-spinner-wrap"><div class="pd-spinner"></div></div>
        } @else if (data().length === 0) {
          <div class="pd-empty" style="height:192px">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6e8d5b" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px">
              <path d="M7 10v12"/><path d="M19 10v6a2 2 0 0 1-2 2H7"/>
              <path d="M7 22h10a2 2 0 0 0 2-2v-6"/><path d="M14 10V5a3 3 0 0 0-6 0v5"/>
              <path d="M5 15h14"/>
            </svg>
            <div class="pd-empty__title" style="color:#047857">No UI errors in the selected period.</div>
          </div>
        } @else {
          <div class="apm-tbl__wrap">
            <table class="apm-tbl">
              <thead>
                <tr>
                  <th class="apm-tbl__th">Type</th>
                  <th class="apm-tbl__th">Message</th>
                  <th class="apm-tbl__th">Count</th>
                  <th class="apm-tbl__th">Users</th>
                  <th class="apm-tbl__th">First Seen</th>
                  <th class="apm-tbl__th">Last Seen</th>
                  <th class="apm-tbl__th"></th>
                </tr>
              </thead>
              <tbody>
                @for (row of data(); track row.fingerprint) {
                  <tr class="apm-tbl__row apm-fp__row" (click)="openDetail(row)">
                    <td class="apm-tbl__td">
                      <span class="apm-tbl__badge">{{ row.errorType || 'Unknown' }}</span>
                    </td>
                    <td class="apm-tbl__td apm-fp__msg">{{ row.errorMessage || '' }}</td>
                    <td class="apm-tbl__td apm-tbl__td--num">
                      <span class="apm-fp__count" [class.apm-fp__count--high]="row.count > 50">
                        {{ row.count }}
                      </span>
                    </td>
                    <td class="apm-tbl__td apm-tbl__td--num">
                      <span class="apm-fp__users">
                        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        {{ row.affectedUsers }}
                      </span>
                    </td>
                    <td class="apm-tbl__td apm-tbl__td--muted">{{ timeAgo(row.firstSeen) }}</td>
                    <td class="apm-tbl__td apm-tbl__td--muted">{{ timeAgo(row.lastSeen) }}</td>
                    <td class="apm-tbl__td">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
                        style="color:var(--pd-text-muted)">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>

    <!-- Detail modal overlay -->
    @if (selected()) {
      <div class="apm-fp__overlay" (click)="closeDetail()">
        <div class="apm-fp__modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">

          <!-- Modal header -->
          <div class="apm-fp__modal-header">
            <div class="apm-fp__modal-meta">
              <div class="apm-fp__modal-type">{{ selected()!.errorType }}</div>
              <div class="apm-fp__modal-msg">{{ selected()!.errorMessage }}</div>
              <div class="apm-fp__modal-stats">
                <span>Count: <strong>{{ selected()!.count }}</strong></span>
                <span>Users: <strong>{{ selected()!.affectedUsers }}</strong></span>
                <span>Apps: <strong>{{ selected()!.affectedApps }}</strong></span>
              </div>
            </div>
            <button type="button" class="apm-fp__close" (click)="closeDetail()" aria-label="Close">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <!-- Modal body -->
          <div class="apm-fp__modal-body">
            <!-- Stack preview -->
            <div class="apm-fp__section-title">Stack Preview</div>
            <pre class="apm-fp__stack">{{ selected()!.errorStackPreview || '(no stack)' }}</pre>

            <!-- Occurrences -->
            <div class="apm-fp__section-title" style="margin-top:20px">
              Recent Occurrences (with breadcrumbs)
            </div>

            @if (loadingOcc()) {
              <div class="pd-spinner-wrap" style="height:96px"><div class="pd-spinner"></div></div>
            } @else if (occurrences().length === 0) {
              <div style="font-size:13px;color:var(--pd-text-muted)">No occurrences found.</div>
            } @else {
              @for (occ of occurrences(); track $index) {
                <div class="apm-fp__occ">
                  <div class="apm-fp__occ-header">
                    <div class="apm-fp__occ-meta">
                      <strong>User:</strong> {{ occ.userId }}
                      &nbsp;·&nbsp;<strong>Session:</strong> {{ occ.sessionId.slice(0, 8) }}
                      &nbsp;·&nbsp;<strong>App:</strong> {{ occ.source }}
                      &nbsp;·&nbsp;<strong>Page:</strong> {{ occ.pageUrl }}
                    </div>
                    <div class="apm-fp__occ-time">{{ timeAgo(occ.timestamp) }}</div>
                  </div>

                  @if (parseBreadcrumbs(occ.breadcrumbs).length > 0) {
                    <div class="apm-fp__bc-list">
                      @for (bc of parseBreadcrumbs(occ.breadcrumbs); track $index) {
                        <div class="apm-fp__bc-row">
                          <span class="apm-fp__bc-cat">{{ bc.category }}</span>
                          <span class="apm-fp__bc-msg">{{ bc.message }}</span>
                        </div>
                      }
                    </div>
                  } @else {
                    <div class="apm-fp__bc-empty">No breadcrumbs captured.</div>
                  }
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Row */
    .apm-fp__row { cursor: pointer; }
    .apm-fp__msg { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--pd-text); }
    .apm-fp__count {
      display: inline-block; padding: 2px 8px; border-radius: 12px;
      font-size: 11px; font-weight: 700;
      background: rgba(100,116,139,0.12); color: var(--pd-text-muted);
    }
    .apm-fp__count--high { background: rgba(244,63,94,0.12); color: #be123c; }
    .apm-fp__users { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--pd-text); }

    /* Overlay */
    .apm-fp__overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.48);
      z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .apm-fp__modal {
      background: var(--pd-surface); border-radius: var(--pd-radius);
      max-width: 820px; width: 100%; max-height: 90vh;
      display: flex; flex-direction: column;
      box-shadow: 0 16px 64px rgba(15,23,42,0.22);
      overflow: hidden;
    }
    .apm-fp__modal-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 16px 20px; border-bottom: 1px solid var(--pd-border); flex-shrink: 0;
    }
    .apm-fp__modal-type { font-size: 11px; color: var(--pd-text-muted); margin-bottom: 4px; }
    .apm-fp__modal-msg  { font-size: 14px; font-weight: 600; color: var(--pd-text); }
    .apm-fp__modal-stats {
      display: flex; gap: 16px; margin-top: 8px; font-size: 12px; color: var(--pd-text-muted);
    }
    .apm-fp__modal-stats strong { color: var(--pd-text); }
    .apm-fp__close {
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid var(--pd-border); border-radius: 6px;
      cursor: pointer; color: var(--pd-text-muted); flex-shrink: 0;
      transition: background 0.15s;
    }
    .apm-fp__close:hover { background: var(--pd-surface-muted); }
    .apm-fp__modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
    .apm-fp__section-title { font-size: 13px; font-weight: 600; color: var(--pd-text); margin-bottom: 8px; }
    .apm-fp__stack {
      font-size: 11px; background: #0f172a; color: #e2e8f0;
      padding: 12px 16px; border-radius: 8px; overflow-x: auto; max-height: 180px;
      white-space: pre-wrap; word-break: break-all; margin: 0;
    }

    /* Occurrence */
    .apm-fp__occ {
      border: 1px solid var(--pd-border); border-radius: 8px;
      padding: 12px; margin-bottom: 10px; font-size: 12px;
    }
    .apm-fp__occ-header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .apm-fp__occ-meta { color: var(--pd-text); line-height: 1.6; }
    .apm-fp__occ-time { color: var(--pd-text-muted); white-space: nowrap; }

    /* Breadcrumbs */
    .apm-fp__bc-list { border-left: 3px solid #60a5fa; padding-left: 10px; display: flex; flex-direction: column; gap: 4px; }
    .apm-fp__bc-row  { display: flex; gap: 8px; align-items: baseline; }
    .apm-fp__bc-cat  {
      display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
      border: 1px solid var(--pd-border); color: var(--pd-text-muted); white-space: nowrap; flex-shrink: 0;
    }
    .apm-fp__bc-msg  { font-size: 11px; color: var(--pd-text-muted); }
    .apm-fp__bc-empty { font-size: 12px; color: var(--pd-text-muted); font-style: italic; }
  `],
})
export class ApmErrorFingerprintsTableComponent implements OnDestroy {
  // inputs
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
  data        = signal<ErrorFingerprintRow[]>([]);
  selected    = signal<ErrorFingerprintRow | null>(null);
  occurrences = signal<ErrorOccurrence[]>([]);
  loadingOcc  = signal(false);

  // helpers
  timeAgo(iso: string | undefined): string {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return `${Math.round(diff)}s ago`;
    if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  }

  parseBreadcrumbs(raw: string | undefined): ParsedBreadcrumb[] {
    if (!raw) return [];
    try { return JSON.parse(raw) as ParsedBreadcrumb[]; } catch { return []; }
  }

  openDetail(row: ErrorFingerprintRow): void {
    this.selected.set(row);
    this.occurrences.set([]);
    this.loadingOcc.set(true);
    this.dataProvider
      .getErrorBreadcrumbs({ errorFingerprint: row.fingerprint, limit: 20 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => { this.occurrences.set(res ?? []); this.loadingOcc.set(false); },
        error: ()  => { this.occurrences.set([]); this.loadingOcc.set(false); },
      });
  }

  closeDetail(): void { this.selected.set(null); this.occurrences.set([]); }

  private buildFilter() {
    const dr = this.dateRange();
    let from = dr.from;
    let to   = dr.to;
    if (from && !to) to = getEndOfDay(from);
    const f: any = { limit: 50 };
    if (from && to) { f.startDate = toLocalISOString(from); f.endDate = toLocalISOString(to); }
    if (this.source()) f.source = this.source();
    if (this.roleId() && this.roleId() !== 'all') f.roleId = this.roleId();
    if (this.userId() && this.userId() !== 'all') f.userId = this.userId();
    if (this.pageUrl() && this.pageUrl() !== 'all') f.pageUrl = this.pageUrl();
    return f;
  }

  constructor() {
    this.trigger$.pipe(
      debounceTime(300),
      switchMap(() => {
        this.loading.set(true);
        return this.dataProvider.getErrorFingerprints(this.buildFilter());
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: data => { this.data.set(data ?? []); this.loading.set(false); },
      error: ()  => { this.data.set([]); this.loading.set(false); },
    });

    effect(() => {
      void this.dateRange(); void this.roleId(); void this.userId();
      void this.pageUrl(); void this.source();
      this.trigger$.next();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
