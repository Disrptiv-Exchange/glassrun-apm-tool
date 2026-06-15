/*
 * Performance Dashboard data models.
 *
 * Ported verbatim (shape-for-shape) from the glassRUN frontend's
 * performance-rest.service.ts so the Angular dashboard consumes the exact same
 * .NET APM endpoints and response shapes as the original React dashboard.
 * Keeping these identical is what lets the dashboard "just work" against the
 * existing GetAPM* stored procedures.
 */

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface PerformanceFilterBase {
  startDate?: string;
  endDate?: string;
  pageUrl?: string;
  userId?: string;
  roleId?: string;
  source?: string;
}

export interface ApiPerformanceFilter extends PerformanceFilterBase {
  limit?: number;
  errorOnly?: boolean;
}

export interface PagePerformanceFilter extends PerformanceFilterBase {
  limit?: number;
}

export type TimeSeriesMetric = 'page_load_time' | 'api_response_time' | 'fcp' | 'inp';

export interface TimeSeriesFilter extends PerformanceFilterBase {
  metric: TimeSeriesMetric;
  interval?: 'hour' | 'day';
}

export interface BaseDateFilter {
  startDate?: string;
  endDate?: string;
  source?: string;
}

export interface PluginFilter extends BaseDateFilter { limit?: number; }
export interface ExitPagesFilter extends BaseDateFilter { limit?: number; }
export interface ErrorFingerprintsFilter extends BaseDateFilter { limit?: number; }
export interface ErrorBreadcrumbsFilter { errorFingerprint: string; limit?: number; }
export interface ReleaseComparisonFilter extends BaseDateFilter { limit?: number; }
export interface ApdexFilter extends BaseDateFilter { interval?: 'hour' | 'day'; apdexT?: number; }
export interface BounceRateFilter extends BaseDateFilter { interval?: 'hour' | 'day'; }
export interface PercentilesFilter extends BaseDateFilter {
  metric: 'api_response_time' | 'page_load_time' | 'fcp' | 'lcp' | 'inp';
}

// ---------------------------------------------------------------------------
// Core metrics / stats
// ---------------------------------------------------------------------------

export type Trend = 'up' | 'down' | 'neutral' | 'no_data';

export interface PerformanceMetrics {
  avgPageLoadTime: number;
  avgApiResponseTime: number;
  avgFcp: number;
  avgLcp: number;
  avgInp: number;
  totalApiCalls: number;
  errorRate: number;
  slowestApis: string[];
  fastestApis: string[];
  p95PageLoadTime?: number;
  p95ApiResponseTime?: number;
  apdexScore?: number;
  bounceRate?: number;
}

export interface ApiPerformanceStats {
  apiUrl: string;
  apiMethod: string;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  callCount: number;
  errorCount: number;
  successRate: number;
  previousAvgDuration: number | null;
  trend: Trend;
  avgDnsMs?: number;
  avgTcpMs?: number;
  avgSslMs?: number;
  avgTtfbMs?: number;
  avgResponseDownloadMs?: number;
  p95Duration?: number;
  p99Duration?: number;
}

export interface PagePerformanceStats {
  pageUrl: string;
  avgLoadTime: number;
  avgFcp: number;
  avgLcp: number;
  avgInp: number;
  visitCount: number;
  previousAvgLoadTime: number | null;
  trend: Trend;
}

export interface ErrorAnalysis {
  statusCode: number;
  apiUrl: string;
  count: number;
  percentage: number;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
  label: string;
}

export interface Role {
  roleMasterId: string;
  roleName: string;
}

export interface User {
  loginId: string;
  userName: string;
}

export interface PerformanceDashboardData {
  performanceMetrics: PerformanceMetrics;
  apiPerformanceStats: ApiPerformanceStats[];
  pagePerformanceStats: PagePerformanceStats[];
  errorAnalysis: ErrorAnalysis[];
  timeSeriesData: TimeSeriesDataPoint[];
  roles: Role[];
}

// ---------------------------------------------------------------------------
// App comparison
// ---------------------------------------------------------------------------

export interface AppComparisonStats {
  appName: string;
  avgApiResponseTime: number;
  avgPageLoadTime: number;
  totalApiCalls: number;
  errorRate: number;
  uniqueUsers: number;
  uniqueSessions: number;
}

// ---------------------------------------------------------------------------
// Device breakdown
// ---------------------------------------------------------------------------

export interface DeviceBreakdownRow {
  name: string;
  count: number;
  avgPageLoadTime?: number;
  avgApiResponseTime?: number;
}
export interface DeviceBreakdownOsVersion {
  platform: string;
  osVersion: string;
  count: number;
  avgPageLoadTime: number;
}
export interface DeviceBreakdown {
  byDeviceType: DeviceBreakdownRow[];
  byPlatform: DeviceBreakdownRow[];
  byManufacturer: DeviceBreakdownRow[];
  byModel: (DeviceBreakdownRow & { manufacturer?: string })[];
  byOsVersion: DeviceBreakdownOsVersion[];
}

// ---------------------------------------------------------------------------
// Network breakdown
// ---------------------------------------------------------------------------

export interface NetworkBreakdownRow {
  name: string;
  count: number;
  avgApiResponseTime: number;
  avgPageLoadTime: number;
  avgDownlinkMbps: number;
}
export interface NetworkBreakdown {
  byNetworkType: NetworkBreakdownRow[];
  byEffectiveType: NetworkBreakdownRow[];
}

// ---------------------------------------------------------------------------
// Cold start
// ---------------------------------------------------------------------------

export interface ColdStartByApp { appName: string; count: number; avgColdStartMs: number; }
export interface ColdStartByVersion { appName: string; appVersion: string; count: number; avgColdStartMs: number; }
export interface ColdStartByDevice { model: string; platform: string; count: number; avgColdStartMs: number; }
export interface ColdStartTrendPoint { date: string; count: number; avgColdStartMs: number; }
export interface ColdStartStats {
  totalColdStarts: number;
  avgColdStartMs: number;
  minColdStartMs: number;
  maxColdStartMs: number;
  byApp: ColdStartByApp[];
  byAppVersion: ColdStartByVersion[];
  byDeviceModel: ColdStartByDevice[];
  trend: ColdStartTrendPoint[];
}

// ---------------------------------------------------------------------------
// Plugin performance
// ---------------------------------------------------------------------------

export interface PluginSlowestRow {
  pluginName: string;
  pluginMethod: string;
  callCount: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  failureCount: number;
  successRate: number;
}
export interface PluginByNameRow { pluginName: string; callCount: number; avgDurationMs: number; }
export interface PluginPerformance {
  totalCalls: number;
  avgDurationMs: number;
  slowest: PluginSlowestRow[];
  byPlugin: PluginByNameRow[];
}

// ---------------------------------------------------------------------------
// Battery / storage correlation
// ---------------------------------------------------------------------------

export interface BatteryStorageBucketRow {
  batteryBucket?: string;
  state?: string;
  storageBucket?: string;
  count: number;
  avgApiResponseTime: number;
  avgPageLoadTime: number;
}
export interface BatteryStorageCorrelation {
  byBatteryLevel: BatteryStorageBucketRow[];
  byChargingState: BatteryStorageBucketRow[];
  byStorage: BatteryStorageBucketRow[];
}

// ---------------------------------------------------------------------------
// Offline stats
// ---------------------------------------------------------------------------

export interface OfflineByAppRow { appName: string; offlineCount: number; totalCount: number; avgQueueDurationMs: number; }
export interface OfflineTrendRow { date: string; offlineCount: number; totalCount: number; }
export interface OfflineStats {
  totalLogs: number;
  offlineQueuedCount: number;
  offlineQueuedPercentage: number;
  avgQueueDurationMs: number;
  maxQueueDurationMs: number;
  affectedSessions: number;
  affectedUsers: number;
  byApp: OfflineByAppRow[];
  trend: OfflineTrendRow[];
}

// ---------------------------------------------------------------------------
// Apdex & bounce (time series)
// ---------------------------------------------------------------------------

export interface ApdexTimePoint {
  timeBucket: string;
  totalSamples: number;
  satisfied: number;
  tolerating: number;
  frustrated: number;
  apdex: number;
}
export interface BounceRateTimePoint {
  timeBucket: string;
  totalSessions: number;
  bouncedSessions: number;
  bounceRate: number;
}

// ---------------------------------------------------------------------------
// Exit pages
// ---------------------------------------------------------------------------

export interface ExitPageRow {
  pageUrl: string;
  exitCount: number;
  totalVisits: number;
  avgPageViewsInSession: number;
  exitRate: number;
}

// ---------------------------------------------------------------------------
// Error fingerprints / occurrences
// ---------------------------------------------------------------------------

export interface ErrorFingerprintRow {
  fingerprint: string;
  errorType: string;
  errorMessage: string;
  errorStackPreview: string;
  errorUrl: string;
  errorComponent: string;
  count: number;
  affectedUsers: number;
  affectedApps: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ErrorOccurrence {
  apmLogId?: number;
  timestamp: string;
  userId: string;
  sessionId: string;
  source: string;
  pageUrl: string;
  errorType: string;
  errorMessage: string;
  errorStack: string;
  errorUrl: string;
  breadcrumbs: string;
  deviceType: string;
  platform: string;
  deviceVersion: string;
  deviceVersionNumber: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Release comparison
// ---------------------------------------------------------------------------

export interface ReleaseComparisonRow {
  releaseVersion: string;
  firstSeen: string;
  lastSeen: string;
  uniqueUsers: number;
  uniqueSessions: number;
  avgApiResponseTime: number;
  avgPageLoadTime: number;
  uiErrorCount: number;
  apiErrorRate: number;
}

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

export interface PercentileStats {
  metric: string;
  sampleCount: number;
  average: number;
  min: number;
  max: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

// ---------------------------------------------------------------------------
// Dashboard-level UI types
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export type DashboardSource = 'Portal' | 'CustomerAPP' | 'DeliveryAPP' | 'YardAPP';

/** A selectable page in the Portal page filter (host app supplies these). */
export interface DashboardPageOption {
  value: string;   // controller name sent as pageUrl
  label: string;   // display label
}
