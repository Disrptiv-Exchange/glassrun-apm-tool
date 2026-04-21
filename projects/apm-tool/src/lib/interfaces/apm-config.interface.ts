import { MonitoringConfig } from './monitoring.interfaces';

export interface ApmConfig extends MonitoringConfig {
  /** App-specific source identifier, e.g. "Portal", "CustomerAPP_V14" */
  source?: string;
  /** Numeric app type code, e.g. "4605" */
  appType?: string | number;
  /** Whether this is a production build */
  production?: boolean;
  /** URL patterns to skip in the HTTP interceptor (case-insensitive substring match) */
  skipUrlPatterns?: string[];
  /** Whether Capacitor plugins are available (auto-detected if not set) */
  capacitorAvailable?: boolean;
  /** Mobile source identifier, e.g. "CustomerAPP_V14" */
  mobileSource?: string;

  // GR-9408 additions
  /** Release/deployment version tag (for per-release performance comparison) */
  releaseVersion?: string;
  /** Max number of breadcrumbs to keep in rolling buffer (default 20) */
  breadcrumbMaxEntries?: number;
  /** Apdex "Satisfied" threshold in milliseconds (default 500). 4T is the "Tolerating" threshold. */
  apdexThresholdMs?: number;
  /** Max offline queue size (default 1000). Logs beyond this limit are dropped oldest-first. */
  offlineQueueMaxSize?: number;
  /** Enable breadcrumb recording (default true) */
  enableBreadcrumbs?: boolean;
  /** Enable offline queuing (default true) */
  enableOfflineQueue?: boolean;
}
