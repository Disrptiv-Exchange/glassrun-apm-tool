import { Component, ChangeDetectionStrategy, computed, inject, input, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, switchMap, takeUntil, tap } from 'rxjs/operators';
import { ApmDashboardDataProvider } from '../data/apm-dashboard-data.provider';
import { TrendGranularity, TrendHistoryMeta, TrendHistoryPoint } from '../models/apm-dashboard.models';

/**
 * The long-range section of the dashboard: weeks or months over up to six months.
 *
 * ── WHY THIS LIVES ON THE SAME SCREEN ───────────────────────────────────────────────────────
 * It would have been easier to build a separate "History" page, and worse. Someone looking at a
 * spike this afternoon needs to know whether last month looked the same, and a second screen
 * with its own filters makes that a comparison the user has to do from memory. So this sits in
 * the Trends tab, under the same command bar, honouring the same Source and Role filters.
 *
 * ── THE ONE THING IT MUST BE HONEST ABOUT ───────────────────────────────────────────────────
 * Live tabs read raw rows; this reads the rollup tier. Three consequences the UI states rather
 * than hides:
 *
 *   1. A badge naming the data source and the grain, so a number here is never mistaken for a
 *      raw measurement.
 *   2. p95 comes from histogram bands and is approximate (~2%). It is labelled "p95 approx".
 *   3. There is no per-user breakdown, because the rollup drops UserId by design. The host
 *      disables the user filter for this view; this panel also says so, so the reason is
 *      visible where the question gets asked.
 *
 * A metric with no samples in a bucket renders as a gap, never as zero: a zero on a latency
 * chart reads as "instantaneous" and is the most flattering possible lie.
 */
@Component({
  selector: 'apm-history-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pd-card apm-history">

  <!-- ===== Header: what am I looking at ===== -->
  <div class="apm-history__head">
    <div>
      <div class="apm-history__title">Historical performance</div>
      <div class="apm-history__sub">
        @if (meta(); as m) {
          <span class="apm-history__badge" [title]="dataSourceTooltip()">
            {{ m.dataSource === 'rollup-daily' ? 'Aggregated history' : m.dataSource }}
          </span>
          <span class="apm-history__dim">
            {{ grainLabel(m.granularity) }} &middot; {{ m.startDate }} to {{ m.endDate }}
            @if (m.rollupCoversUpTo) { &middot; complete to {{ m.rollupCoversUpTo }} }
          </span>
        } @else {
          <span class="apm-history__dim">No aggregated data for this range yet.</span>
        }
      </div>
    </div>

    <!-- Grain override. 'auto' is the default and is what most people should leave it on;
         the explicit choices exist for when someone is chasing a specific week. -->
    <div class="apm-history__grain" role="group" aria-label="History granularity">
      @for (g of grains; track g.value) {
        <button type="button"
          [class]="'pd-segment__btn' + (granularity() === g.value ? ' pd-segment__btn--active' : '')"
          [title]="g.hint"
          (click)="granularity.set(g.value)">{{ g.label }}</button>
      }
    </div>
  </div>

  @if (loading()) {
    <div class="apm-history__state">Loading history…</div>
  } @else if (error()) {
    <div class="apm-history__state apm-history__state--err">{{ error() }}</div>
  } @else if (!points().length) {
    <!-- Deliberately specific. "No data" sends people hunting; naming the likely cause does not. -->
    <div class="apm-history__state">
      Nothing aggregated for this range.
      @if (meta()?.earliestAvailable) {
        History starts at {{ meta()!.earliestAvailable }} — try a later start date.
      } @else {
        The rollup job may not have run yet.
      }
    </div>
  } @else {

    <!-- ===== Metric picker + sparkline ===== -->
    <div class="apm-history__metrics" role="tablist" aria-label="Metric">
      @for (m of metricDefs; track m.key) {
        <button type="button" role="tab"
          [attr.aria-selected]="metric() === m.key"
          [class]="'apm-history__mbtn' + (metric() === m.key ? ' apm-history__mbtn--active' : '')"
          (click)="metric.set(m.key)">
          <span class="apm-history__mbtn-label">{{ m.label }}</span>
          <span class="apm-history__mbtn-val">{{ fmt(latest(m.key), m.unit) }}</span>
          @if (deltaOf(m.key); as d) {
            <span class="apm-history__mbtn-delta"
                  [class.apm-history__mbtn-delta--bad]="d.worse"
                  [class.apm-history__mbtn-delta--good]="!d.worse">
              {{ d.text }}
            </span>
          }
        </button>
      }
    </div>

    <!-- Inline SVG rather than a charting dependency: this is one series over at most a few
         dozen buckets, and the library already avoids adding runtime deps for that. -->
    <div class="apm-history__chart">
      <svg [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH" preserveAspectRatio="none"
           role="img" [attr.aria-label]="currentMetricDef().label + ' over time'">
        <!-- gridlines -->
        @for (t of yTicks(); track t.v) {
          <line [attr.x1]="padL" [attr.x2]="chartW - padR" [attr.y1]="t.y" [attr.y2]="t.y"
                stroke="currentColor" stroke-opacity="0.12" stroke-width="1" />
          <text [attr.x]="padL - 6" [attr.y]="t.y + 3" text-anchor="end"
                font-size="9" fill="currentColor" fill-opacity="0.55">{{ t.label }}</text>
        }
        <!-- the series. Each contiguous run of real samples is its own path, so a bucket with
             no data leaves a visible gap instead of a straight line pretending continuity. -->
        @for (seg of segments(); track seg.d) {
          <path [attr.d]="seg.d" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" class="apm-history__line" />
        }
        @for (p of plotted(); track p.i) {
          <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" class="apm-history__dot">
            <title>{{ p.label }}: {{ fmt(p.v, currentMetricDef().unit) }}</title>
          </circle>
        }
      </svg>
      <div class="apm-history__xaxis">
        @for (p of xLabels(); track p.i) {
          <span [style.left.%]="p.pct">{{ p.label }}</span>
        }
      </div>
    </div>

    <!-- ===== The numbers ===== -->
    <!-- A chart shows the shape; the table is what gets pasted into a status update. -->
    <div class="apm-history__tablewrap">
      <table class="apm-history__table">
        <thead>
          <tr>
            <th>Period</th>
            <th class="num">API calls</th>
            <th class="num">Avg API</th>
            <th class="num" title="Reconstructed from histogram bands; accurate to about 2%">p95 API *</th>
            <th class="num">Page views</th>
            <th class="num">Avg load</th>
            <th class="num">Errors</th>
            <th class="num">Error %</th>
            <th class="num" title="1.00 is perfect. Below 0.85 is poor.">Apdex</th>
            <th class="num" [title]="userCountTooltip()">Users</th>
          </tr>
        </thead>
        <tbody>
          @for (p of pointsDesc(); track p.bucketStart) {
            <tr>
              <td>{{ p.bucketLabel }}</td>
              <td class="num">{{ p.apiCalls | number }}</td>
              <td class="num">{{ fmt(p.avgApiMs, 'ms') }}</td>
              <td class="num">{{ fmt(p.p95ApiMs, 'ms') }}</td>
              <td class="num">{{ p.pageViews | number }}</td>
              <td class="num">{{ fmt(p.avgPageLoadMs, 'ms') }}</td>
              <td class="num">{{ p.errors | number }}</td>
              <td class="num" [class.apm-history__bad]="(p.errorRatePct ?? 0) > 1">{{ fmt(p.errorRatePct, '%') }}</td>
              <td class="num" [class.apm-history__bad]="(p.apdex ?? 1) < 0.85">{{ fmt(p.apdex, 'score') }}</td>
              <td class="num">
                {{ p.distinctUsers ?? '—' }}@if (!p.isUserCountExact && p.distinctUsers !== null) {<span class="apm-history__approx">+</span>}
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="apm-history__foot">
      * p95 is reconstructed from stored histogram bands, so it is within roughly 2% rather than
      exact. Aggregated history carries no per-user detail, so the user filter does not apply
      here and a "+" marks a user count that is a lower bound for the period.
    </div>
  }
</div>
  `,
  styles: [`
    .apm-history { display:flex; flex-direction:column; gap:14px; }
    .apm-history__head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
    .apm-history__title { font-size:15px; font-weight:600; }
    .apm-history__sub { margin-top:4px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .apm-history__badge {
      font-size:11px; font-weight:600; padding:2px 8px; border-radius:10px;
      background:rgba(99,102,241,0.12); color:#6366f1; white-space:nowrap; cursor:help;
    }
    .apm-history__dim { font-size:12px; opacity:0.65; }
    .apm-history__grain { display:flex; gap:4px; }
    .apm-history__state { padding:28px 8px; text-align:center; font-size:13px; opacity:0.7; }
    .apm-history__state--err { color:#b00020; opacity:1; }

    .apm-history__metrics { display:flex; gap:8px; flex-wrap:wrap; }
    .apm-history__mbtn {
      display:flex; flex-direction:column; gap:2px; align-items:flex-start;
      padding:8px 12px; border:1px solid rgba(128,128,128,0.25); border-radius:8px;
      background:transparent; cursor:pointer; min-width:116px; text-align:left; font:inherit;
      color:inherit;
    }
    .apm-history__mbtn--active { border-color:#6366f1; background:rgba(99,102,241,0.08); }
    .apm-history__mbtn-label { font-size:11px; opacity:0.7; }
    .apm-history__mbtn-val { font-size:16px; font-weight:600; }
    .apm-history__mbtn-delta { font-size:11px; font-weight:600; }
    .apm-history__mbtn-delta--bad { color:#b00020; }
    .apm-history__mbtn-delta--good { color:#047857; }

    .apm-history__chart { position:relative; }
    .apm-history__chart svg { width:100%; height:190px; display:block; color:#6366f1; }
    .apm-history__line { stroke:#6366f1; }
    .apm-history__dot { fill:#6366f1; }
    .apm-history__xaxis { position:relative; height:16px; margin-top:2px; }
    .apm-history__xaxis span {
      position:absolute; transform:translateX(-50%); font-size:10px; opacity:0.6; white-space:nowrap;
    }

    .apm-history__tablewrap { overflow-x:auto; }
    .apm-history__table { width:100%; border-collapse:collapse; font-size:12px; }
    .apm-history__table th, .apm-history__table td { padding:6px 10px; border-bottom:1px solid rgba(128,128,128,0.15); }
    .apm-history__table th { text-align:left; font-weight:600; opacity:0.7; white-space:nowrap; }
    .apm-history__table .num { text-align:right; font-variant-numeric:tabular-nums; }
    .apm-history__bad { color:#b00020; font-weight:600; }
    .apm-history__approx { opacity:0.5; }
    .apm-history__foot { font-size:11px; opacity:0.55; line-height:1.5; }
  `]
})
export class ApmHistoryPanelComponent {
  private provider = inject(ApmDashboardDataProvider);

  /** Honours the same command-bar filters as every other tab. */
  source = input<string>('all');
  roleId = input<string>('');
  pageUrl = input<string>('');
  /** Months of history to request. 6 is the design target. */
  months = input<number>(6);

  granularity = signal<TrendGranularity | 'auto'>('auto');
  metric = signal<string>('avgApiMs');

  points = signal<TrendHistoryPoint[]>([]);
  meta = signal<TrendHistoryMeta | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  readonly grains: { value: TrendGranularity | 'auto'; label: string; hint: string }[] = [
    { value: 'auto',  label: 'Auto',    hint: 'Pick the grain from the range length' },
    { value: 'day',   label: 'Daily',   hint: 'One point per day' },
    { value: 'week',  label: 'Weekly',  hint: 'One point per week, starting Monday' },
    { value: 'month', label: 'Monthly', hint: 'One point per calendar month' },
  ];

  // Lower is better for every one of these except Apdex, which is why `higherIsBetter` exists:
  // a 10% rise in Apdex is good news and a 10% rise in latency is not, and one shared arrow
  // colour for both would be actively misleading.
  readonly metricDefs: { key: string; label: string; unit: string; higherIsBetter?: boolean }[] = [
    { key: 'avgApiMs',      label: 'Avg API',    unit: 'ms' },
    { key: 'p95ApiMs',      label: 'p95 API',    unit: 'ms' },
    { key: 'avgPageLoadMs', label: 'Avg load',   unit: 'ms' },
    { key: 'errorRatePct',  label: 'Error rate', unit: '%' },
    { key: 'apdex',         label: 'Apdex',      unit: 'score', higherIsBetter: true },
    { key: 'apiCalls',      label: 'Volume',     unit: 'n',     higherIsBetter: true },
  ];

  readonly chartW = 720;
  readonly chartH = 190;
  readonly padL = 44;
  readonly padR = 10;
  readonly padT = 10;
  readonly padB = 14;

  private destroy$ = new Subject<void>();
  private trigger$ = new Subject<void>();

  constructor() {
    this.trigger$
      .pipe(
        // The command bar can fire several signal changes for one user action (preset click
        // updates both ends of the range); debounce collapses those into one request.
        debounceTime(120),
        tap(() => { this.loading.set(true); this.error.set(null); }),
        switchMap(() => {
          const to = new Date();
          const from = new Date();
          from.setMonth(from.getMonth() - Math.max(1, this.months()));
          return this.provider.getTrendHistory({
            startDate: this.iso(from),
            endDate: this.iso(to),
            granularity: this.granularity(),
            source: this.source() || 'all',
            roleId: this.roleId() || 'all',
            pageUrl: this.pageUrl() || 'all',
          }).pipe(catchError(() => {
            this.error.set('History could not be loaded. The rollup tables may not be deployed yet.');
            return of({ points: [], meta: null });
          }));
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(res => {
        this.points.set(res.points ?? []);
        this.meta.set(res.meta ?? null);
        this.loading.set(false);
      });

    effect(() => {
      // Read every input that should refetch, then fire once.
      this.source(); this.roleId(); this.pageUrl(); this.months(); this.granularity();
      this.trigger$.next();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  // ---- derived -----------------------------------------------------------

  pointsDesc = computed(() => [...this.points()].reverse());

  currentMetricDef = computed(() =>
    this.metricDefs.find(m => m.key === this.metric()) ?? this.metricDefs[0]);

  private series = computed(() =>
    this.points().map(p => (p as any)[this.metric()] as number | null));

  latest(key: string): number | null {
    const ps = this.points();
    for (let i = ps.length - 1; i >= 0; i--) {
      const v = (ps[i] as any)[key];
      if (v !== null && v !== undefined) return v as number;
    }
    return null;
  }

  /**
   * Change between the last two buckets that both have a value.
   *
   * Deliberately skips empty buckets rather than treating them as zero — comparing against a
   * bucket with no traffic would manufacture a dramatic "improvement" out of a quiet weekend.
   */
  deltaOf(key: string): { text: string; worse: boolean } | null {
    const vals = this.points()
      .map(p => (p as any)[key] as number | null)
      .filter(v => v !== null && v !== undefined) as number[];
    if (vals.length < 2) return null;

    const prev = vals[vals.length - 2];
    const curr = vals[vals.length - 1];
    if (!prev) return null;

    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    if (Math.abs(pct) < 0.5) return { text: 'flat', worse: false };

    const def = this.metricDefs.find(m => m.key === key);
    const rose = pct > 0;
    const worse = def?.higherIsBetter ? !rose : rose;
    return { text: `${rose ? '+' : ''}${pct.toFixed(0)}%`, worse };
  }

  private bounds = computed(() => {
    const vals = this.series().filter(v => v !== null && v !== undefined) as number[];
    if (!vals.length) return { min: 0, max: 1 };
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { max = min + 1; }
    // Latency and counts start at zero so the eye reads magnitude, not just wiggle. Apdex is
    // scored 0..1 and would be unreadable zero-based, so it keeps a padded window.
    if (this.currentMetricDef().unit !== 'score') min = 0;
    else { const pad = (max - min) * 0.2; min = Math.max(0, min - pad); max = Math.min(1, max + pad); }
    return { min, max };
  });

  private xy(i: number, v: number) {
    const n = Math.max(1, this.points().length - 1);
    const { min, max } = this.bounds();
    const x = this.padL + (i / n) * (this.chartW - this.padL - this.padR);
    const y = this.padT + (1 - (v - min) / (max - min)) * (this.chartH - this.padT - this.padB);
    return { x, y };
  }

  plotted = computed(() => {
    const out: { i: number; x: number; y: number; v: number; label: string }[] = [];
    this.series().forEach((v, i) => {
      if (v === null || v === undefined) return;
      const { x, y } = this.xy(i, v);
      out.push({ i, x, y, v, label: this.points()[i].bucketLabel });
    });
    return out;
  });

  /** One path per contiguous run, so gaps stay gaps. */
  segments = computed(() => {
    const segs: { d: string }[] = [];
    let cur: string[] = [];
    this.series().forEach((v, i) => {
      if (v === null || v === undefined) {
        if (cur.length > 1) segs.push({ d: cur.join(' ') });
        cur = [];
        return;
      }
      const { x, y } = this.xy(i, v);
      cur.push(`${cur.length ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    });
    if (cur.length > 1) segs.push({ d: cur.join(' ') });
    return segs;
  });

  yTicks = computed(() => {
    const { min, max } = this.bounds();
    const unit = this.currentMetricDef().unit;
    return [0, 0.5, 1].map(f => {
      const v = min + (max - min) * (1 - f);
      return {
        v,
        y: this.padT + f * (this.chartH - this.padT - this.padB),
        label: this.fmt(v, unit)
      };
    });
  });

  xLabels = computed(() => {
    const ps = this.points();
    if (!ps.length) return [];
    // At most six labels, else they overlap at daily grain across six months.
    const step = Math.max(1, Math.ceil(ps.length / 6));
    const out: { i: number; pct: number; label: string }[] = [];
    for (let i = 0; i < ps.length; i += step) {
      const n = Math.max(1, ps.length - 1);
      const xFrac = i / n;
      const px = this.padL + xFrac * (this.chartW - this.padL - this.padR);
      out.push({ i, pct: (px / this.chartW) * 100, label: ps[i].bucketLabel });
    }
    return out;
  });

  dataSourceTooltip = computed(() => {
    const m = this.meta();
    if (!m) return '';
    return 'Read from the pre-aggregated rollup tables rather than raw event rows. '
         + 'Averages are exact; p95 is reconstructed from histogram bands (about 2% accurate). '
         + (m.rollupCoversUpTo ? `Aggregated up to ${m.rollupCoversUpTo}.` : '');
  });

  userCountTooltip = computed(() =>
    this.granularity() === 'day'
      ? 'Distinct users for the day.'
      : 'A distinct count cannot be summed across days, so this is the busiest single day in the period — a lower bound, marked with "+".');

  // ---- formatting --------------------------------------------------------

  grainLabel(g: TrendGranularity): string {
    return g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly';
  }

  fmt(v: number | null | undefined, unit: string): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (unit === 'score') return v.toFixed(2);
    if (unit === '%') return `${v.toFixed(2)}%`;
    if (unit === 'n') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
    // ms: seconds past a thousand, because "4.6s" is read faster than "4635ms".
    return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
  }

  private iso(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}
