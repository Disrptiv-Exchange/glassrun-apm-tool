/*
 * Public API Surface of @disrptiv-exchange/apm-tool
 */

// Interfaces (type-only exports)
export type {
  MonitoringConfig,
  Transaction,
  Span,
  TransactionContext,
  SpanContext,
  HttpContext,
  NavigationTimingMetrics,
  PaintTimingMetrics,
  ResourceTimingMetrics,
  WebVitalsMetrics,
  PerformanceMetrics
} from './lib/interfaces/monitoring.interfaces';
export type { ApmConfig } from './lib/interfaces/apm-config.interface';
export type { ApmTransport } from './lib/interfaces/apm-transport.interface';
export type { ApmUserProvider, ApmUserInfo } from './lib/interfaces/apm-user-provider.interface';
export type { ApmDeviceDetector, ApmBatteryInfo, ApmStorageInfo } from './lib/interfaces/apm-device-detector.interface';
export type { Breadcrumb } from './lib/services/monitoring.service';

// Tokens
export { APM_CONFIG, APM_TRANSPORT, APM_USER_PROVIDER, APM_DEVICE_DETECTOR } from './lib/tokens/injection-tokens';

// Services
export { MonitoringService } from './lib/services/monitoring.service';
export { RouteMonitoringService } from './lib/services/route-monitoring.service';

// Interceptor
export { MonitoringHttpInterceptor } from './lib/interceptors/monitoring-http.interceptor';

// Error Handler
export { GlobalErrorHandler } from './lib/handlers/apm-error-handler';

// Providers
export { provideApmMonitoring, getApmProviders, DEFAULT_APM_CONFIG, initializeMonitoring } from './lib/providers/apm-monitoring.providers';
export type { ApmProviderOptions } from './lib/providers/apm-monitoring.providers';
export { ApmMonitoringModule } from './lib/providers/apm-monitoring.module';
export type { ApmModuleOptions } from './lib/providers/apm-monitoring.module';
