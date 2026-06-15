// ---- Public surface for the Performance Dashboard ----

// Config + DI
export { APM_DASHBOARD_CONFIG, provideApmDashboard } from './data/apm-dashboard.config';
export type { ApmDashboardConfig, ApmDashboardSourceOption } from './data/apm-dashboard.config';

// Data provider
export { ApmDashboardDataProvider } from './data/apm-dashboard-data.provider';
export { HttpApmDashboardDataProvider } from './data/http-apm-dashboard-data.provider';

// Models
// PerformanceMetrics is aliased to avoid clashing with the capture-side
// PerformanceMetrics already exported from the package root.
export type {
  PerformanceMetrics as DashboardPerformanceMetrics,
  ApiPerformanceStats, PagePerformanceStats, ErrorAnalysis,
  TimeSeriesDataPoint, DateRange, DashboardSource, DashboardPageOption,
  Role, User, PerformanceFilterBase, ApiPerformanceFilter, PagePerformanceFilter,
  TimeSeriesFilter, BaseDateFilter, PluginFilter, ExitPagesFilter,
  ErrorFingerprintsFilter, ErrorBreadcrumbsFilter, ReleaseComparisonFilter,
  ApdexFilter, BounceRateFilter, PercentilesFilter,
  AppComparisonStats, DeviceBreakdown, NetworkBreakdown, ColdStartStats, PluginPerformance,
  BatteryStorageCorrelation, OfflineStats, ApdexTimePoint, BounceRateTimePoint,
  ExitPageRow, ErrorFingerprintRow, ErrorOccurrence, ReleaseComparisonRow, PercentileStats,
  Trend,
} from './models/apm-dashboard.models';

// Components
export { ApmDashboardComponent } from './components/apm-dashboard.component';
export { ApmKpiRibbonComponent } from './components/apm-kpi-ribbon.component';
export { ApmApiPerformanceChartComponent } from './components/apm-api-performance-chart.component';
export { ApmPagePerformanceChartComponent } from './components/apm-page-performance-chart.component';
export { ApmPerformanceTableComponent } from './components/apm-performance-table.component';
export type { TableType } from './components/apm-performance-table.component';
export { ApmErrorAnalysisChartComponent } from './components/apm-error-analysis-chart.component';
export { ApmErrorFingerprintsTableComponent } from './components/apm-error-fingerprints-table.component';

// Phase C components
export { ApmTimeSeriesChartComponent } from './components/apm-time-series-chart.component';
export { ApmPercentilesWidgetComponent } from './components/apm-percentiles-widget.component';
export { ApmReleaseComparisonTableComponent } from './components/apm-release-comparison-table.component';
export { ApmMobileTabComponent } from './components/apm-mobile-tab.component';
export { ApmNetworkBreakdownChartComponent } from './components/apm-network-breakdown-chart.component';
export { ApmUserExperienceTabComponent } from './components/apm-user-experience-tab.component';
export { ApmAppsComparisonChartComponent } from './components/apm-apps-comparison-chart.component';

// Chart kit
export { ApmComboChartComponent } from './charts/apm-combo-chart.component';
export type { ChartDataPoint } from './charts/apm-combo-chart.component';
export { ApmAreaChartComponent } from './charts/apm-area-chart.component';
export type { ExtraLine } from './charts/apm-area-chart.component';
export { ApmPieChartComponent } from './charts/apm-pie-chart.component';
export type { PieSlice } from './charts/apm-pie-chart.component';
export { ApmNetworkWaterfallChartComponent } from './charts/apm-network-waterfall-chart.component';
export { ApmGroupedBarChartComponent } from './charts/apm-grouped-bar-chart.component';
export type { GroupedBarSeries } from './charts/apm-grouped-bar-chart.component';
export { ApmLineChartComponent } from './charts/apm-line-chart.component';
export type { LineChartPoint } from './charts/apm-line-chart.component';
