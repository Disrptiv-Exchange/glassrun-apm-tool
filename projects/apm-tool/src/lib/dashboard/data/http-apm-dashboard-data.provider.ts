import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApmDashboardDataProvider } from './apm-dashboard-data.provider';
import { APM_DASHBOARD_CONFIG } from './apm-dashboard.config';
import {
  PerformanceFilterBase, ApiPerformanceFilter, PagePerformanceFilter, TimeSeriesFilter,
  BaseDateFilter, PluginFilter, ExitPagesFilter, ErrorFingerprintsFilter, ErrorBreadcrumbsFilter,
  ReleaseComparisonFilter, ApdexFilter, BounceRateFilter, PercentilesFilter,
  PerformanceMetrics, ApiPerformanceStats, PagePerformanceStats, ErrorAnalysis, TimeSeriesDataPoint,
  Role, User, AppComparisonStats, DeviceBreakdown, NetworkBreakdown, NetworkBreakdownRow,
  DeviceBreakdownRow, ColdStartStats, PluginPerformance, BatteryStorageCorrelation,
  BatteryStorageBucketRow, OfflineStats, ApdexTimePoint, BounceRateTimePoint, ExitPageRow,
  ErrorFingerprintRow, ErrorOccurrence, ReleaseComparisonRow, PercentileStats
} from '../models/apm-dashboard.models';

/**
 * Default HttpClient-based implementation of {@link ApmDashboardDataProvider}.
 *
 * POSTs an XML-style `{ Json: {...} }` envelope to the configured `GetAPM*`
 * endpoints and unwraps/normalizes the responses. The unwrap + mapping logic is
 * a faithful port of the glassRUN frontend's PerformanceRestService, so this
 * works against the existing stored procedures without backend changes.
 */
@Injectable()
export class HttpApmDashboardDataProvider extends ApmDashboardDataProvider {
  private http = inject(HttpClient);
  private config = inject(APM_DASHBOARD_CONFIG);

  // ---- transport ---------------------------------------------------------

  private post(endpointName: string, json: any): Observable<any> {
    const url = this.config.endpointUrl(endpointName, this.config.baseUrl);
    const headers = new HttpHeaders(this.config.authHeaders() || {});
    return this.http.post(url, { Json: json }, { headers });
  }

  private buildRequestPayload(filter: PerformanceFilterBase): any {
    return {
      StartDate: filter.startDate || '',
      EndDate: filter.endDate || '',
      PageUrl: filter.pageUrl || 'all',
      UserId: filter.userId || 'all',
      RoleId: filter.roleId || 'all',
      Source: filter.source || 'portal',
    };
  }

  private buildBasePayload(filter: BaseDateFilter): any {
    return {
      StartDate: filter.startDate || '',
      EndDate: filter.endDate || '',
      Source: filter.source || 'all',
    };
  }

  /** Calls a GR-9408 endpoint and descends through Result/single-wrapper-key. */
  private callAPMEndpoint(endpointName: string, json: any): Observable<any> {
    return this.post(endpointName, json).pipe(
      map((res: any) => {
        let data = this.unwrapResponse(res);
        if (data?.Result !== undefined) data = data.Result;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const keys = Object.keys(data);
          if (keys.length === 1 && /^[A-Z]/.test(keys[0])) {
            const inner = data[keys[0]];
            if (inner !== null && typeof inner === 'object') data = inner;
          }
        }
        return data;
      })
    );
  }

  // ---- core endpoints ----------------------------------------------------

  getPerformanceMetrics(filter: PerformanceFilterBase): Observable<PerformanceMetrics> {
    return this.post('GetAPMPerformanceMetrics', this.buildRequestPayload(filter))
      .pipe(map(res => this.transformPerformanceMetricsResponse(res)));
  }

  getApiPerformanceStats(filter: ApiPerformanceFilter): Observable<ApiPerformanceStats[]> {
    const json = {
      StartDate: filter.startDate || '', EndDate: filter.endDate || '',
      Limit: filter.limit ?? 10, PageUrl: filter.pageUrl || 'all',
      UserId: filter.userId || 'all', RoleId: filter.roleId || 'all',
      Source: filter.source || 'portal', ErrorOnly: filter.errorOnly ?? false,
    };
    return this.post('GetAPMApiPerformanceStats', json)
      .pipe(map(res => this.transformApiStatsResponse(res)));
  }

  getPagePerformanceStats(filter: PagePerformanceFilter): Observable<PagePerformanceStats[]> {
    const json = {
      StartDate: filter.startDate || '', EndDate: filter.endDate || '',
      Limit: filter.limit ?? 10, PageUrl: filter.pageUrl || 'all',
      UserId: filter.userId || 'all', RoleId: filter.roleId || 'all',
      Source: filter.source || 'portal',
    };
    return this.post('GetAPMPagePerformanceStats', json)
      .pipe(map(res => this.transformPageStatsResponse(res)));
  }

  getErrorAnalysis(filter: PerformanceFilterBase): Observable<ErrorAnalysis[]> {
    return this.post('GetAPMErrorAnalysis', this.buildRequestPayload(filter))
      .pipe(map(res => this.transformErrorAnalysisResponse(res)));
  }

  getTimeSeriesData(filter: TimeSeriesFilter): Observable<TimeSeriesDataPoint[]> {
    const json = {
      Metric: filter.metric, StartDate: filter.startDate || '', EndDate: filter.endDate || '',
      Interval: filter.interval || 'hour', PageUrl: filter.pageUrl || 'all',
      UserId: filter.userId || 'all', RoleId: filter.roleId || 'all', Source: filter.source || 'portal',
    };
    return this.post('GetAPMTimeSeriesData', json)
      .pipe(map(res => this.transformTimeSeriesResponse(res)));
  }

  getRoles(): Observable<Role[]> {
    return this.post('GetAPMRoles', {}).pipe(map(res => this.transformRolesResponse(res)));
  }

  getUsersByRole(roleMasterId: string): Observable<User[]> {
    return this.post('GetAPMUsersByRole', { RoleMasterId: roleMasterId })
      .pipe(map(res => this.transformUsersResponse(res)));
  }

  // ---- GR-9408 endpoints -------------------------------------------------

  getAppComparison(filter: BaseDateFilter): Observable<AppComparisonStats[]> {
    return this.callAPMEndpoint('GetAPMAppComparison', this.buildBasePayload(filter))
      .pipe(map(d => this.mapAppComparison(d)));
  }

  getDeviceBreakdown(filter: BaseDateFilter): Observable<DeviceBreakdown> {
    return this.callAPMEndpoint('GetAPMDeviceBreakdown', this.buildBasePayload(filter))
      .pipe(map(d => this.mapDeviceBreakdown(d)));
  }

  getNetworkBreakdown(filter: BaseDateFilter): Observable<NetworkBreakdown> {
    return this.callAPMEndpoint('GetAPMNetworkBreakdown', this.buildBasePayload(filter))
      .pipe(map(d => this.mapNetworkBreakdown(d)));
  }

  getColdStartStats(filter: BaseDateFilter): Observable<ColdStartStats> {
    return this.callAPMEndpoint('GetAPMColdStartStats', this.buildBasePayload(filter))
      .pipe(map(d => this.mapColdStartStats(d)));
  }

  getPluginPerformance(filter: PluginFilter): Observable<PluginPerformance> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Limit: filter.limit ?? 20 };
    return this.callAPMEndpoint('GetAPMPluginPerformance', json).pipe(map(d => this.mapPluginPerformance(d)));
  }

  getBatteryStorageCorrelation(filter: BaseDateFilter): Observable<BatteryStorageCorrelation> {
    return this.callAPMEndpoint('GetAPMBatteryStorageCorrelation', this.buildBasePayload(filter))
      .pipe(map(d => this.mapBatteryStorageCorrelation(d)));
  }

  getOfflineStats(filter: BaseDateFilter): Observable<OfflineStats> {
    return this.callAPMEndpoint('GetAPMOfflineStats', this.buildBasePayload(filter))
      .pipe(map(d => this.mapOfflineStats(d)));
  }

  getApdexScore(filter: ApdexFilter): Observable<ApdexTimePoint[]> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Interval: filter.interval || 'hour', ApdexT: filter.apdexT ?? 500 };
    return this.callAPMEndpoint('GetAPMApdexScore', json).pipe(map(d => this.mapApdexSeries(d)));
  }

  getBounceRate(filter: BounceRateFilter): Observable<BounceRateTimePoint[]> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Interval: filter.interval || 'day' };
    return this.callAPMEndpoint('GetAPMBounceRate', json).pipe(map(d => this.mapBounceRateSeries(d)));
  }

  getExitPages(filter: ExitPagesFilter): Observable<ExitPageRow[]> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Limit: filter.limit ?? 20 };
    return this.callAPMEndpoint('GetAPMExitPages', json).pipe(map(d => this.mapExitPages(d)));
  }

  getErrorFingerprints(filter: ErrorFingerprintsFilter): Observable<ErrorFingerprintRow[]> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Limit: filter.limit ?? 50 };
    return this.callAPMEndpoint('GetAPMErrorFingerprints', json).pipe(map(d => this.mapErrorFingerprints(d)));
  }

  getErrorBreadcrumbs(filter: ErrorBreadcrumbsFilter): Observable<ErrorOccurrence[]> {
    const json = { ErrorFingerprint: filter.errorFingerprint, Limit: filter.limit ?? 20 };
    return this.callAPMEndpoint('GetAPMErrorBreadcrumbs', json).pipe(map(d => this.mapErrorOccurrences(d)));
  }

  getReleaseComparison(filter: ReleaseComparisonFilter): Observable<ReleaseComparisonRow[]> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Limit: filter.limit ?? 10 };
    return this.callAPMEndpoint('GetAPMReleaseComparison', json).pipe(map(d => this.mapReleaseComparison(d)));
  }

  getPercentiles(filter: PercentilesFilter): Observable<PercentileStats> {
    const json = { StartDate: filter.startDate || '', EndDate: filter.endDate || '', Source: filter.source || 'all', Metric: filter.metric };
    return this.callAPMEndpoint('GetAPMPercentiles', json).pipe(map(d => this.mapPercentiles(d)));
  }

  // ---- mappers (ported) --------------------------------------------------

  private mapAppComparison(data: any): AppComparisonStats[] {
    return this.extractArray(data?.Apps ?? data).map((r: any) => ({
      appName: r.AppName || r.appName || '',
      avgApiResponseTime: Number(r.AvgApiResponseTime) || 0,
      avgPageLoadTime: Number(r.AvgPageLoadTime) || 0,
      totalApiCalls: Number(r.TotalApiCalls) || 0,
      errorRate: Number(r.ErrorRate) || 0,
      uniqueUsers: Number(r.UniqueUsers) || 0,
      uniqueSessions: Number(r.UniqueSessions) || 0,
    }));
  }

  private mapDeviceBreakdown(data: any): DeviceBreakdown {
    const d = data || {};
    const mapRow = (r: any): DeviceBreakdownRow => ({
      name: r.Name || r.name || '',
      count: Number(r.Count) || 0,
      avgPageLoadTime: r.AvgPageLoadTime != null ? Number(r.AvgPageLoadTime) : undefined,
      avgApiResponseTime: r.AvgApiResponseTime != null ? Number(r.AvgApiResponseTime) : undefined,
    });
    return {
      byDeviceType: this.extractArray(d.ByDeviceType).map(mapRow),
      byPlatform: this.extractArray(d.ByPlatform).map(mapRow),
      byManufacturer: this.extractArray(d.ByManufacturer).map(mapRow),
      byModel: this.extractArray(d.ByModel).map((r: any) => ({ ...mapRow(r), manufacturer: r.Manufacturer || r.manufacturer })),
      byOsVersion: this.extractArray(d.ByOsVersion).map((r: any) => ({
        platform: r.Platform || '', osVersion: r.OsVersion || '',
        count: Number(r.Count) || 0, avgPageLoadTime: Number(r.AvgPageLoadTime) || 0,
      })),
    };
  }

  private mapNetworkBreakdown(data: any): NetworkBreakdown {
    const d = data || {};
    const mapRow = (r: any): NetworkBreakdownRow => ({
      name: r.Name || r.name || '',
      count: Number(r.Count) || 0,
      avgApiResponseTime: Number(r.AvgApiResponseTime) || 0,
      avgPageLoadTime: Number(r.AvgPageLoadTime) || 0,
      avgDownlinkMbps: Number(r.AvgDownlinkMbps) || 0,
    });
    return {
      byNetworkType: this.extractArray(d.ByNetworkType).map(mapRow),
      byEffectiveType: this.extractArray(d.ByEffectiveType).map(mapRow),
    };
  }

  private mapColdStartStats(data: any): ColdStartStats {
    const d = data || {};
    return {
      totalColdStarts: Number(d.TotalColdStarts) || 0,
      avgColdStartMs: Number(d.AvgColdStartMs) || 0,
      minColdStartMs: Number(d.MinColdStartMs) || 0,
      maxColdStartMs: Number(d.MaxColdStartMs) || 0,
      byApp: this.extractArray(d.ByApp).map((r: any) => ({ appName: r.AppName || '', count: Number(r.Count) || 0, avgColdStartMs: Number(r.AvgColdStartMs) || 0 })),
      byAppVersion: this.extractArray(d.ByAppVersion).map((r: any) => ({ appName: r.AppName || '', appVersion: r.AppVersion || '', count: Number(r.Count) || 0, avgColdStartMs: Number(r.AvgColdStartMs) || 0 })),
      byDeviceModel: this.extractArray(d.ByDeviceModel).map((r: any) => ({ model: r.Model || '', platform: r.Platform || '', count: Number(r.Count) || 0, avgColdStartMs: Number(r.AvgColdStartMs) || 0 })),
      trend: this.extractArray(d.Trend).map((r: any) => ({ date: r.Date || '', count: Number(r.Count) || 0, avgColdStartMs: Number(r.AvgColdStartMs) || 0 })),
    };
  }

  private mapPluginPerformance(data: any): PluginPerformance {
    const d = data || {};
    return {
      totalCalls: Number(d.TotalCalls) || 0,
      avgDurationMs: Number(d.AvgDurationMs) || 0,
      slowest: this.extractArray(d.Slowest).map((r: any) => ({
        pluginName: r.PluginName || '', pluginMethod: r.PluginMethod || '',
        callCount: Number(r.CallCount) || 0, avgDurationMs: Number(r.AvgDurationMs) || 0,
        minDurationMs: Number(r.MinDurationMs) || 0, maxDurationMs: Number(r.MaxDurationMs) || 0,
        failureCount: Number(r.FailureCount) || 0, successRate: Number(r.SuccessRate) || 0,
      })),
      byPlugin: this.extractArray(d.ByPlugin).map((r: any) => ({ pluginName: r.PluginName || '', callCount: Number(r.CallCount) || 0, avgDurationMs: Number(r.AvgDurationMs) || 0 })),
    };
  }

  private mapBatteryStorageCorrelation(data: any): BatteryStorageCorrelation {
    const d = data || {};
    const mapRow = (r: any): BatteryStorageBucketRow => ({
      batteryBucket: r.BatteryBucket, state: r.State, storageBucket: r.StorageBucket,
      count: Number(r.Count) || 0, avgApiResponseTime: Number(r.AvgApiResponseTime) || 0, avgPageLoadTime: Number(r.AvgPageLoadTime) || 0,
    });
    return {
      byBatteryLevel: this.extractArray(d.ByBatteryLevel).map(mapRow),
      byChargingState: this.extractArray(d.ByChargingState).map(mapRow),
      byStorage: this.extractArray(d.ByStorage).map(mapRow),
    };
  }

  private mapOfflineStats(data: any): OfflineStats {
    const d = data || {};
    return {
      totalLogs: Number(d.TotalLogs) || 0,
      offlineQueuedCount: Number(d.OfflineQueuedCount) || 0,
      offlineQueuedPercentage: Number(d.OfflineQueuedPercentage) || 0,
      avgQueueDurationMs: Number(d.AvgQueueDurationMs) || 0,
      maxQueueDurationMs: Number(d.MaxQueueDurationMs) || 0,
      affectedSessions: Number(d.AffectedSessions) || 0,
      affectedUsers: Number(d.AffectedUsers) || 0,
      byApp: this.extractArray(d.ByApp).map((r: any) => ({ appName: r.AppName || '', offlineCount: Number(r.OfflineCount) || 0, totalCount: Number(r.TotalCount) || 0, avgQueueDurationMs: Number(r.AvgQueueDurationMs) || 0 })),
      trend: this.extractArray(d.Trend).map((r: any) => ({ date: r.Date || '', offlineCount: Number(r.OfflineCount) || 0, totalCount: Number(r.TotalCount) || 0 })),
    };
  }

  private mapApdexSeries(data: any): ApdexTimePoint[] {
    return this.extractArray(data?.TimeSeries ?? data).map((r: any) => ({
      timeBucket: r.TimeBucket || '', totalSamples: Number(r.TotalSamples) || 0,
      satisfied: Number(r.Satisfied) || 0, tolerating: Number(r.Tolerating) || 0,
      frustrated: Number(r.Frustrated) || 0, apdex: Number(r.Apdex) || 0,
    }));
  }

  private mapBounceRateSeries(data: any): BounceRateTimePoint[] {
    return this.extractArray(data?.TimeSeries ?? data).map((r: any) => ({
      timeBucket: r.TimeBucket || '', totalSessions: Number(r.TotalSessions) || 0,
      bouncedSessions: Number(r.BouncedSessions) || 0, bounceRate: Number(r.BounceRate) || 0,
    }));
  }

  private mapExitPages(data: any): ExitPageRow[] {
    return this.extractArray(data?.Items ?? data).map((r: any) => ({
      pageUrl: r.PageUrl || '', exitCount: Number(r.ExitCount) || 0, totalVisits: Number(r.TotalVisits) || 0,
      avgPageViewsInSession: Number(r.AvgPageViewsInSession) || 0, exitRate: Number(r.ExitRate) || 0,
    }));
  }

  private mapErrorFingerprints(data: any): ErrorFingerprintRow[] {
    return this.extractArray(data?.Fingerprints ?? data).map((r: any) => ({
      fingerprint: r.Fingerprint || '', errorType: r.ErrorType || '', errorMessage: r.ErrorMessage || '',
      errorStackPreview: r.ErrorStackPreview || '', errorUrl: r.ErrorUrl || '', errorComponent: r.ErrorComponent || '',
      count: Number(r.Count) || 0, affectedUsers: Number(r.AffectedUsers) || 0, affectedApps: Number(r.AffectedApps) || 0,
      firstSeen: r.FirstSeen || '', lastSeen: r.LastSeen || '',
    }));
  }

  private mapErrorOccurrences(data: any): ErrorOccurrence[] {
    return this.extractArray(data?.Occurrences ?? data).map((r: any) => ({
      apmLogId: r.APMLogId, timestamp: r.Timestamp || '', userId: String(r.UserId || ''), sessionId: String(r.SessionId || ''),
      source: r.Source || '', pageUrl: r.PageUrl || '', errorType: r.ErrorType || '', errorMessage: r.ErrorMessage || '',
      errorStack: r.ErrorStack || '', errorUrl: r.ErrorUrl || '', breadcrumbs: r.Breadcrumbs || '',
      deviceType: r.DeviceType || '', platform: r.Platform || '', deviceVersion: r.DeviceVersion || '',
      deviceVersionNumber: r.DeviceVersionNumber || '', model: r.Model || '',
    }));
  }

  private mapReleaseComparison(data: any): ReleaseComparisonRow[] {
    return this.extractArray(data?.Releases ?? data).map((r: any) => ({
      releaseVersion: r.ReleaseVersion || '', firstSeen: r.FirstSeen || '', lastSeen: r.LastSeen || '',
      uniqueUsers: Number(r.UniqueUsers) || 0, uniqueSessions: Number(r.UniqueSessions) || 0,
      avgApiResponseTime: Number(r.AvgApiResponseTime) || 0, avgPageLoadTime: Number(r.AvgPageLoadTime) || 0,
      uiErrorCount: Number(r.UIErrorCount) || 0, apiErrorRate: Number(r.ApiErrorRate) || 0,
    }));
  }

  private mapPercentiles(data: any): PercentileStats {
    const d = data || {};
    return {
      metric: d.Metric || '', sampleCount: Number(d.SampleCount) || 0, average: Number(d.Average) || 0,
      min: Number(d.Min) || 0, max: Number(d.Max) || 0, p50: Number(d.P50) || 0, p75: Number(d.P75) || 0,
      p90: Number(d.P90) || 0, p95: Number(d.P95) || 0, p99: Number(d.P99) || 0,
    };
  }

  private extractArray(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.Item) return Array.isArray(data.Item) ? data.Item : [data.Item];
    if (data.Items && data.Items.Item) return Array.isArray(data.Items.Item) ? data.Items.Item : [data.Items.Item];
    if (typeof data === 'object') return [data];
    return [];
  }

  // ---- core transforms (ported) ------------------------------------------

  private unwrapResponse(response: any): any {
    if (!response) return response;
    if (Array.isArray(response)) return response;
    if (response.Json) return response.Json;
    if (response.Data) return response.Data;
    if (response.json) return response.json;
    if (response.data) return response.data;
    if (response.Roles) return response.Roles;
    if (response.Users) return response.Users;
    if (response.ApiPerformanceStats) return response.ApiPerformanceStats;
    if (response.Items) return response.Items;
    return response;
  }

  private transformPerformanceMetricsResponse(response: any): PerformanceMetrics {
    const data = this.unwrapResponse(response);
    const empty: PerformanceMetrics = {
      avgPageLoadTime: 0, avgApiResponseTime: 0, avgFcp: 0, avgLcp: 0, avgInp: 0,
      totalApiCalls: 0, errorRate: 0, slowestApis: [], fastestApis: [],
    };
    if (!data) return empty;
    const metrics = data?.Result?.PerformanceMetrics || data;

    const splitOrArray = (v: any): string[] =>
      typeof v === 'string' ? v.split('||').filter((s: string) => s.trim()) : (Array.isArray(v) ? v : []);

    return {
      avgPageLoadTime: Number(metrics.AvgPageLoadTime) || 0,
      avgApiResponseTime: Number(metrics.AvgApiResponseTime) || 0,
      avgFcp: Number(metrics.AvgFcp) || 0,
      avgLcp: Number(metrics.AvgLcp) || 0,
      avgInp: Number(metrics.AvgInp) || 0,
      totalApiCalls: Number(metrics.TotalApiCalls) || 0,
      errorRate: Number(metrics.ErrorRate) || 0,
      slowestApis: splitOrArray(metrics.SlowestApis),
      fastestApis: splitOrArray(metrics.FastestApis),
      p95PageLoadTime: metrics.P95PageLoadTime != null ? Number(metrics.P95PageLoadTime) : undefined,
      p95ApiResponseTime: metrics.P95ApiResponseTime != null ? Number(metrics.P95ApiResponseTime) : undefined,
      apdexScore: metrics.ApdexScore != null ? Number(metrics.ApdexScore) : undefined,
      bounceRate: metrics.BounceRate != null ? Number(metrics.BounceRate) : undefined,
    };
  }

  private transformApiStatsResponse(response: any): ApiPerformanceStats[] {
    const data = this.unwrapResponse(response);
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return [];
    const node = data?.Result?.ApiPerformanceStats ?? data;
    const arr = Array.isArray(node) ? node : (node && typeof node === 'object' ? [node] : []);
    return arr.map((row: any) => ({
      apiUrl: row.ApiUrl || row.apiUrl,
      apiMethod: row.ApiMethod || row.apiMethod,
      avgDuration: Number(row.AvgDuration) || 0,
      minDuration: Number(row.MinDuration) || 0,
      maxDuration: Number(row.MaxDuration) || 0,
      callCount: Number(row.CallCount) || 0,
      errorCount: Number(row.ErrorCount) || 0,
      successRate: Number(row.SuccessRate) || 0,
      previousAvgDuration: row.PreviousAvgDuration != null ? Number(row.PreviousAvgDuration) : null,
      trend: row.Trend || row.trend || 'no_data',
      avgDnsMs: row.AvgDnsMs != null ? Number(row.AvgDnsMs) : undefined,
      avgTcpMs: row.AvgTcpMs != null ? Number(row.AvgTcpMs) : undefined,
      avgSslMs: row.AvgSslMs != null ? Number(row.AvgSslMs) : undefined,
      avgTtfbMs: row.AvgTtfbMs != null ? Number(row.AvgTtfbMs) : undefined,
      avgResponseDownloadMs: row.AvgResponseDownloadMs != null ? Number(row.AvgResponseDownloadMs) : undefined,
      p95Duration: row.P95Duration != null ? Number(row.P95Duration) : undefined,
      p99Duration: row.P99Duration != null ? Number(row.P99Duration) : undefined,
    }));
  }

  private transformPageStatsResponse(response: any): PagePerformanceStats[] {
    const data = this.unwrapResponse(response);
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return [];
    const itemNode = data?.Result?.Items?.Item ?? data;
    const arr = Array.isArray(itemNode) ? itemNode : (itemNode && typeof itemNode === 'object' ? [itemNode] : []);
    return arr.map((row: any) => ({
      pageUrl: row.PageUrl || row.pageUrl,
      avgLoadTime: Number(row.AvgLoadTime) || 0,
      avgFcp: Number(row.AvgFcp) || 0,
      avgLcp: Number(row.AvgLcp) || 0,
      avgInp: Number(row.AvgInp) || 0,
      visitCount: Number(row.VisitCount) || 0,
      previousAvgLoadTime: row.PreviousAvgLoadTime != null ? Number(row.PreviousAvgLoadTime) : null,
      trend: row.Trend || row.trend || 'no_data',
    }));
  }

  private transformErrorAnalysisResponse(response: any): ErrorAnalysis[] {
    const data = this.unwrapResponse(response);
    const itemNode = data?.Result?.Items?.Item ?? data;
    const arr = Array.isArray(itemNode) ? itemNode : (itemNode && typeof itemNode === 'object' ? [itemNode] : []);
    return arr.map((row: any) => ({
      statusCode: row.StatusCode ?? row.statusCode ?? 0,
      apiUrl: row.ApiUrl || row.apiUrl || '',
      count: Number(row.Count) || 0,
      percentage: Number(row.Percentage) || 0,
    }));
  }

  private transformTimeSeriesResponse(response: any): TimeSeriesDataPoint[] {
    const data = this.unwrapResponse(response);
    const itemNode = data?.Result?.Items?.Item ?? data;
    const arr = Array.isArray(itemNode) ? itemNode : (itemNode && typeof itemNode === 'object' ? [itemNode] : []);
    return arr.map((row: any) => ({
      timestamp: row.Timestamp || row.timestamp,
      value: Number(row.Value) || 0,
      label: row.Label || row.label || '',
    }));
  }

  private transformRolesResponse(response: any): Role[] {
    try {
      const data = this.unwrapResponse(response);
      if (!data) return [];
      let arr: any[] | null = null;
      if (typeof data === 'string') { try { arr = JSON.parse(data); } catch { return []; } }
      else if (Array.isArray(data)) arr = data;
      else if (data?.Result?.Roles?.Role && Array.isArray(data.Result.Roles.Role)) arr = data.Result.Roles.Role;
      else if (data.Roles && Array.isArray(data.Roles)) arr = data.Roles;
      else if (data.Json) arr = typeof data.Json === 'string' ? JSON.parse(data.Json) : data.Json;
      if (!arr || !Array.isArray(arr)) return [];
      return arr.map((row: any) => ({ roleMasterId: (row.RoleMasterId ?? row.roleMasterId ?? '').toString(), roleName: row.RoleName ?? row.roleName ?? '' }));
    } catch { return []; }
  }

  private transformUsersResponse(response: any): User[] {
    try {
      const data = this.unwrapResponse(response);
      if (!data) return [];
      let arr: any[] | null = null;
      if (typeof data === 'string') { try { arr = JSON.parse(data); } catch { return []; } }
      else if (Array.isArray(data)) arr = data;
      else if (data?.Result?.Users?.User && Array.isArray(data.Result.Users.User)) arr = data.Result.Users.User;
      else if (data.Users && Array.isArray(data.Users)) arr = data.Users;
      else if (data.Json) arr = typeof data.Json === 'string' ? JSON.parse(data.Json) : data.Json;
      if (!arr || !Array.isArray(arr)) return [];
      return arr.map((row: any) => ({ loginId: (row.LoginId ?? row.loginId ?? row.UserId ?? row.userId ?? '').toString(), userName: row.UserName ?? row.userName ?? '' }));
    } catch { return []; }
  }
}
