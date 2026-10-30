import { Observable, of } from 'rxjs';
import {
  ThresholdConfig, ApmAlert, ThresholdConfigFilter, AlertsFilter,
  PerformanceFilterBase, ApiPerformanceFilter, PagePerformanceFilter, TimeSeriesFilter,
  BaseDateFilter, PluginFilter, ExitPagesFilter, ErrorFingerprintsFilter, ErrorBreadcrumbsFilter,
  ReleaseComparisonFilter, ApdexFilter, BounceRateFilter, PercentilesFilter,
  PerformanceMetrics, ApiPerformanceStats, PagePerformanceStats, ErrorAnalysis, TimeSeriesDataPoint,
  Role, User, AppComparisonStats, DeviceBreakdown, NetworkBreakdown, ColdStartStats, PluginPerformance,
  BatteryStorageCorrelation, OfflineStats, ApdexTimePoint, BounceRateTimePoint, ExitPageRow,
  ErrorFingerprintRow, ErrorOccurrence, ReleaseComparisonRow, PercentileStats
} from '../models/apm-dashboard.models';

/**
 * Data contract for the Performance Dashboard.
 *
 * This is the Angular-native equivalent of the React dashboard's `window.apmApi`
 * bridge. The library ships a default HttpClient-based implementation
 * ({@link HttpApmDashboardDataProvider}) that talks to the same `GetAPM*` .NET
 * endpoints, but any host app can provide its own implementation (e.g. one that
 * delegates to an existing service) by overriding this abstract class in DI.
 *
 * Every method returns an Observable so the dashboard can cancel in-flight
 * requests when filters change.
 */
export abstract class ApmDashboardDataProvider {
  abstract getPerformanceMetrics(filter: PerformanceFilterBase): Observable<PerformanceMetrics>;
  abstract getApiPerformanceStats(filter: ApiPerformanceFilter): Observable<ApiPerformanceStats[]>;
  abstract getPagePerformanceStats(filter: PagePerformanceFilter): Observable<PagePerformanceStats[]>;
  abstract getErrorAnalysis(filter: PerformanceFilterBase): Observable<ErrorAnalysis[]>;
  abstract getTimeSeriesData(filter: TimeSeriesFilter): Observable<TimeSeriesDataPoint[]>;

  abstract getRoles(): Observable<Role[]>;
  abstract getUsersByRole(roleMasterId: string): Observable<User[]>;

  abstract getAppComparison(filter: BaseDateFilter): Observable<AppComparisonStats[]>;
  abstract getDeviceBreakdown(filter: BaseDateFilter): Observable<DeviceBreakdown>;
  abstract getNetworkBreakdown(filter: BaseDateFilter): Observable<NetworkBreakdown>;
  abstract getColdStartStats(filter: BaseDateFilter): Observable<ColdStartStats>;
  abstract getPluginPerformance(filter: PluginFilter): Observable<PluginPerformance>;
  abstract getBatteryStorageCorrelation(filter: BaseDateFilter): Observable<BatteryStorageCorrelation>;
  abstract getOfflineStats(filter: BaseDateFilter): Observable<OfflineStats>;
  abstract getApdexScore(filter: ApdexFilter): Observable<ApdexTimePoint[]>;
  abstract getBounceRate(filter: BounceRateFilter): Observable<BounceRateTimePoint[]>;
  abstract getExitPages(filter: ExitPagesFilter): Observable<ExitPageRow[]>;
  abstract getErrorFingerprints(filter: ErrorFingerprintsFilter): Observable<ErrorFingerprintRow[]>;
  abstract getErrorBreadcrumbs(filter: ErrorBreadcrumbsFilter): Observable<ErrorOccurrence[]>;
  abstract getReleaseComparison(filter: ReleaseComparisonFilter): Observable<ReleaseComparisonRow[]>;
  abstract getPercentiles(filter: PercentilesFilter): Observable<PercentileStats>;

  // -------------------------------------------------------------------------
  // Thresholds & alerting
  //
  // Concrete rather than abstract on purpose: a host app that already implements this
  // class keeps compiling without change, and simply shows no thresholds or alerts until
  // it overrides these. Making them abstract would be a breaking change to every consumer.
  // -------------------------------------------------------------------------

  /** Threshold rules. Returning [] makes the KPI ribbon fall back to its built-in defaults. */
  getThresholdConfig(_filter?: ThresholdConfigFilter): Observable<ThresholdConfig[]> {
    return of([]);
  }

  /** Alert history. Returning [] hides the alerts panel. */
  getAlerts(_filter?: AlertsFilter): Observable<ApmAlert[]> {
    return of([]);
  }

  /** Upsert threshold rules from the admin screen. Returns the saved rows. */
  saveThresholdConfig(_rows: Partial<ThresholdConfig>[]): Observable<ThresholdConfig[]> {
    return of([]);
  }
}
