/**
 * ApmKpiRibbonComponent
 * Ported from PerformanceMetrics.jsx.
 * Horizontal scrollable KPI tile strip with chevron nav + skeleton.
 */

import {
  Component, ChangeDetectionStrategy, ViewEncapsulation, ElementRef,
  viewChild, input, computed, effect, signal, OnDestroy, PLATFORM_ID, inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  PerformanceMetrics, ThresholdConfig, THRESHOLD_METRIC_CODES,
} from '../models/apm-dashboard.models';

type Tone = 'good' | 'warn' | 'poor' | 'info' | 'neutral';

interface KpiTileData {
  label: string;
  icon: 'clock' | 'activity' | 'zap' | 'maximize' | 'trending' | 'alert' | 'gauge' | 'logout' | 'bar';
  value: string;
  status: { tone: Tone; label: string };
  sub?: string;
}

function fmt(ms: number | undefined | null): string {
  if (ms == null || isNaN(ms)) return '—';
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
  const s = abs / 1000;
  return `${sign}${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;
}
function fmtN(n: number | undefined | null): string {
  return n == null || isNaN(n) ? '—' : Number(n).toLocaleString();
}
function fmtPct(n: number | undefined | null, d = 1): string {
  return typeof n === 'number' ? `${n.toFixed(d)}%` : '—';
}

/**
 * The built-in limits, used when no threshold config is supplied.
 *
 * These are the values this component has always applied. Keeping them here means a host
 * app that does not serve SSP_APM_GetThresholdConfig behaves exactly as before, and a host
 * that does gets the same colours on day one because the seed script uses these numbers.
 */
const DEFAULT_LIMITS: Record<string, { warn: number; danger: number }> = {
  [THRESHOLD_METRIC_CODES.avgPageLoad]:    { warn: 2000, danger: 4000 },
  [THRESHOLD_METRIC_CODES.avgApiResponse]: { warn:  500, danger: 1000 },
  [THRESHOLD_METRIC_CODES.fcp]:            { warn: 1800, danger: 3000 },
  [THRESHOLD_METRIC_CODES.lcp]:            { warn: 2500, danger: 4000 },
  [THRESHOLD_METRIC_CODES.inp]:            { warn:  200, danger:  500 },
  [THRESHOLD_METRIC_CODES.errorRate]:      { warn:    1, danger:    5 },
  [THRESHOLD_METRIC_CODES.apdex]:          { warn: 0.94, danger: 0.85 },
  [THRESHOLD_METRIC_CODES.bounceRate]:     { warn:   40, danger:   60 },
};

/** Resolved limits for one metric, after config has been layered over the defaults. */
interface Limits { warn: number; danger: number; direction: 'Above' | 'Below'; }

function vitalStatus(v: number | undefined | null, limits: Limits): { tone: Tone; label: string } {
  if (v == null || isNaN(v)) return { tone: 'neutral', label: '—' };
  if (limits.direction === 'Below') {
    if (v <= limits.danger) return { tone: 'poor', label: 'Poor' };
    if (v <= limits.warn)   return { tone: 'warn', label: 'Warn' };
    return { tone: 'good', label: 'Good' };
  }
  if (v >= limits.danger) return { tone: 'poor', label: 'Poor' };
  if (v >= limits.warn)   return { tone: 'warn', label: 'Warn' };
  return { tone: 'good', label: 'Good' };
}
function apdexTone(v: number | undefined | null, limits: Limits): { tone: Tone; label: string } {
  if (v == null || isNaN(v)) return { tone: 'neutral', label: '—' };
  if (v >= limits.warn)   return { tone: 'good', label: 'Excellent' };
  if (v >= limits.danger) return { tone: 'warn', label: 'Fair' };
  return { tone: 'poor', label: 'Poor' };
}
function bounceTone(v: number | undefined | null, limits: Limits): { tone: Tone; label: string } {
  if (v == null || isNaN(v)) return { tone: 'neutral', label: '—' };
  if (v < limits.warn)   return { tone: 'good', label: 'Healthy' };
  if (v < limits.danger) return { tone: 'warn', label: 'Watch' };
  return { tone: 'poor', label: 'High' };
}

@Component({
  selector: 'apm-kpi-ribbon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pd-kpi-ribbon-wrapper"
         #wrapper
         [attr.data-overflow-start]="overflowStart()"
         [attr.data-overflow-end]="overflowEnd()">

      <button type="button" class="pd-ribbon-nav pd-ribbon-nav--prev" (click)="scrollBy(-1)" aria-label="Scroll left">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/>
        </svg>
      </button>

      <div class="pd-kpi-ribbon" #ribbon (scroll)="onScroll()">
        @if (!metrics()) {
          @for (sk of skeletonCount; track $index) {
            <div class="pd-kpi-tile pd-kpi-tile--skeleton">
              <div style="height:12px;width:55%"></div>
              <div style="height:24px;width:45%"></div>
              <div style="height:10px;width:70%"></div>
            </div>
          }
        } @else {
          @for (tile of tiles(); track tile.label) {
            <div class="pd-kpi-tile" [attr.data-status]="tile.status.tone">
              <div class="pd-kpi-tile__head">
                <div class="pd-kpi-tile__label">
                  <svg class="pd-kpi-tile__icon" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" [innerHTML]="iconPath(tile.icon)"></svg>
                  <span>{{ tile.label }}</span>
                </div>
                @if (tile.status.label !== '—') {
                  <span class="pd-kpi-chip" [attr.data-tone]="tile.status.tone">
                    <span class="pd-kpi-chip__dot"></span>
                    {{ tile.status.label }}
                  </span>
                }
              </div>
              <div class="pd-kpi-tile__body">
                <div class="pd-kpi-tile__value">{{ tile.value }}</div>
              </div>
              @if (tile.sub) {
                <div class="pd-kpi-tile__sub">{{ tile.sub }}</div>
              }
            </div>
          }
        }
      </div>

      <button type="button" class="pd-ribbon-nav pd-ribbon-nav--next" (click)="scrollBy(1)" aria-label="Scroll right">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6"/>
        </svg>
      </button>
    </div>
  `,
})
export class ApmKpiRibbonComponent implements OnDestroy {
  metrics = input<PerformanceMetrics | null>(null);

  /**
   * Threshold rules from SSP_APM_GetThresholdConfig. Any metric not covered here falls back
   * to DEFAULT_LIMITS, so passing nothing (or a partial set) is always safe.
   *
   * This is what makes a tile's colour and the alert that fires for it come from the same
   * numbers, instead of the UI and the evaluator drifting apart.
   */
  thresholds = input<ThresholdConfig[] | null>(null);

  /** Global rules only; a per-page or per-endpoint rule does not apply to a global tile. */
  private limitsByMetric = computed<Record<string, Limits>>(() => {
    const out: Record<string, Limits> = {};
    for (const [code, d] of Object.entries(DEFAULT_LIMITS)) {
      out[code] = { warn: d.warn, danger: d.danger, direction: code === THRESHOLD_METRIC_CODES.apdex ? 'Below' : 'Above' };
    }
    for (const t of this.thresholds() ?? []) {
      if (!t?.metricCode || t.isActive === false) continue;
      if (t.scope && t.scope !== 'Global') continue;
      const base = out[t.metricCode];
      out[t.metricCode] = {
        warn:   t.warningValue ?? base?.warn   ?? 0,
        danger: t.dangerValue  ?? base?.danger ?? 0,
        direction: t.direction ?? base?.direction ?? 'Above',
      };
    }
    return out;
  });

  private limitsFor(metricCode: string): Limits {
    return this.limitsByMetric()[metricCode] ?? { warn: 0, danger: 0, direction: 'Above' };
  }

  readonly skeletonCount = Array(8);

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private ribbonRef = viewChild<ElementRef<HTMLElement>>('ribbon');
  private wrapperRef = viewChild<ElementRef<HTMLElement>>('wrapper');
  private ro: ResizeObserver | undefined;

  overflowStart = signal(false);
  overflowEnd   = signal(true);

  tiles = computed((): KpiTileData[] => {
    const m = this.metrics();
    if (!m) return [];
    const all: (KpiTileData | false)[] = [
      { label: 'Avg Page Load',    icon: 'clock',    value: fmt(m.avgPageLoadTime),    status: vitalStatus(m.avgPageLoadTime,    this.limitsFor(THRESHOLD_METRIC_CODES.avgPageLoad)) },
      { label: 'Avg API Response', icon: 'activity', value: fmt(m.avgApiResponseTime), status: vitalStatus(m.avgApiResponseTime, this.limitsFor(THRESHOLD_METRIC_CODES.avgApiResponse)) },
      { label: 'FCP',              icon: 'zap',      value: fmt(m.avgFcp),             status: vitalStatus(m.avgFcp, this.limitsFor(THRESHOLD_METRIC_CODES.fcp)), sub: 'First Contentful Paint' },
      { label: 'LCP',              icon: 'maximize', value: fmt(m.avgLcp),             status: vitalStatus(m.avgLcp, this.limitsFor(THRESHOLD_METRIC_CODES.lcp)), sub: 'Largest Contentful Paint' },
      { label: 'INP',              icon: 'trending', value: fmt(m.avgInp),             status: vitalStatus(m.avgInp, this.limitsFor(THRESHOLD_METRIC_CODES.inp)), sub: 'Interaction to Next Paint' },
      { label: 'Error Rate',       icon: 'alert',    value: fmtPct(m.errorRate),       status: vitalStatus(m.errorRate, this.limitsFor(THRESHOLD_METRIC_CODES.errorRate)) },
      typeof m.apdexScore === 'number' && {
        label: 'Apdex Score', icon: 'gauge' as const,
        value: m.apdexScore.toFixed(2),
        status: apdexTone(m.apdexScore, this.limitsFor(THRESHOLD_METRIC_CODES.apdex)),
        sub: 'User satisfaction',
      },
      typeof m.p95ApiResponseTime === 'number' && {
        label: 'P95 API', icon: 'activity' as const,
        value: fmt(m.p95ApiResponseTime),
        // Coloured only when a P95 rule exists; otherwise it stays informational, as before.
        status: this.limitsByMetric()[THRESHOLD_METRIC_CODES.p95ApiResponse]
          ? vitalStatus(m.p95ApiResponseTime, this.limitsFor(THRESHOLD_METRIC_CODES.p95ApiResponse))
          : { tone: 'info' as const, label: '95th pct' },
        sub: 'API Response p95',
      },
      typeof m.bounceRate === 'number' && {
        label: 'Bounce Rate', icon: 'logout' as const,
        value: fmtPct(m.bounceRate),
        status: bounceTone(m.bounceRate, this.limitsFor(THRESHOLD_METRIC_CODES.bounceRate)),
        sub: 'Single-page sessions',
      },
      { label: 'Total API Calls', icon: 'bar', value: fmtN(m.totalApiCalls), status: { tone: 'info' as Tone, label: 'Volume' }, sub: 'In selected period' },
    ];
    return all.filter((t): t is KpiTileData => !!t);
  });

  iconPath(icon: string): string {
    switch (icon) {
      case 'clock':    return '<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>';
      case 'activity': return '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>';
      case 'zap':      return '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>';
      case 'maximize': return '<path stroke-linecap="round" stroke-linejoin="round" d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7"/>';
      case 'trending': return '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>';
      case 'alert':    return '<path stroke-linecap="round" stroke-linejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
      case 'gauge':    return '<path stroke-linecap="round" stroke-linejoin="round" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>';
      case 'logout':   return '<path stroke-linecap="round" stroke-linejoin="round" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>';
      case 'bar':      return '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>';
      default:         return '';
    }
  }

  onScroll(): void { this.updateOverflow(); }

  private updateOverflow(): void {
    const el = this.ribbonRef()?.nativeElement;
    if (!el) return;
    this.overflowStart.set(el.scrollLeft > 2);
    this.overflowEnd.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 2 && el.scrollWidth > el.clientWidth);
  }

  scrollBy(dir: -1 | 1): void {
    const el = this.ribbonRef()?.nativeElement;
    if (!el) return;
    el.scrollBy({ left: dir * 260, behavior: 'smooth' });
  }

  constructor() {
    effect(() => {
      const el = this.ribbonRef()?.nativeElement;
      if (!el || !this.isBrowser) return;
      this.ro?.disconnect();
      this.ro = new ResizeObserver(() => this.updateOverflow());
      this.ro.observe(el);
      this.updateOverflow();
    });
  }
  ngOnDestroy(): void { this.ro?.disconnect(); }
}
