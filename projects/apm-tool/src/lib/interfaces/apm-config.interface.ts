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
  /**
   * How often (ms) to re-check the ApmEnablementGate, when one is supplied. Minimum 1000,
   * default 3000. Ignored without a gate.
   */
  enablementPollMs?: number;

  /**
   * Fraction (0..1) of NORMAL API calls to log. Errors (status >= 400) and calls slower than
   * slowApiThresholdMs are always logged regardless.
   *
   * Default 1.0 - log everything, which is the behaviour before this option existed. Lowering
   * it is the main lever on row volume: a busy app produces far more successful fast calls than
   * interesting ones, and those are the rows that tell you the least.
   */
  apiSampleRate?: number;

  /** An API call at or above this duration is always logged, never sampled out. Default 2000ms. */
  slowApiThresholdMs?: number;

  /**
   * API URLs containing any of these (case-insensitive) are never logged. For high-frequency
   * background endpoints - heartbeats, polling, location pings - whose timings carry no
   * diagnostic value but would dominate the table. Default empty.
   */
  excludedApiPatterns?: string[];

  /**
   * Hard cap on buffered logs awaiting flush. Protects against unbounded growth when the
   * transport cannot deliver for a long period. Default 1000; oldest are dropped first.
   */
  maxBufferSize?: number;

  /**
   * Most logs sent in a single request. Default 10, matching what the per-app implementations
   * this library replaced used. Anything left over goes on the next flush.
   *
   * Keeps the payload bounded through JSON -> encryption -> XML -> OPENXML, and limits the blast
   * radius: one entry the server rejects costs this many rows, not the whole backlog.
   */
  maxBatchSize?: number;

  enableOfflineQueue?: boolean;
}
