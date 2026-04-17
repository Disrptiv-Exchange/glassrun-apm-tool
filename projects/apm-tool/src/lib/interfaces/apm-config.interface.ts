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
}
