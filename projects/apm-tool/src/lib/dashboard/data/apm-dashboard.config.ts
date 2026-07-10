import { InjectionToken, Provider, Type } from '@angular/core';
import { DashboardSource } from '../models/apm-dashboard.models';
import { ApmDashboardDataProvider } from './apm-dashboard-data.provider';
import { HttpApmDashboardDataProvider } from './http-apm-dashboard-data.provider';

export interface ApmDashboardSourceOption {
  value: DashboardSource;
  label: string;
}

export interface ApmDashboardConfig {
  /** Base URL where the `GetAPM*` endpoints are served (no trailing slash). */
  baseUrl: string;
  /**
   * Builds the full request URL for a named APM endpoint.
   * Defaults to `${baseUrl}/${name}`. Override to match a gateway/route scheme.
   */
  endpointUrl?: (name: string, baseUrl: string) => string;
  /** Extra headers (e.g. Authorization) added to every request. Evaluated per request. */
  authHeaders?: () => Record<string, string>;
  /** Source options shown in the Source filter. Defaults to all four glassRUN apps. */
  sources?: ApmDashboardSourceOption[];
  /** Default selected source. Defaults to `'Portal'`. */
  defaultSource?: DashboardSource;
}

export const APM_DASHBOARD_CONFIG = new InjectionToken<Required<ApmDashboardConfig>>('APM_DASHBOARD_CONFIG');

export const DEFAULT_APM_DASHBOARD_SOURCES: ApmDashboardSourceOption[] = [
  { value: 'Portal', label: 'Portal' },
  { value: 'CustomerAPP', label: 'CustomerAPP' },
  { value: 'DeliveryAPP', label: 'DeliveryAPP' },
  { value: 'YardAPP', label: 'YardAPP' },
];

function normalizeConfig(config: ApmDashboardConfig): Required<ApmDashboardConfig> {
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  return {
    baseUrl,
    endpointUrl: config.endpointUrl ?? ((name: string, base: string) => `${base}/${name}`),
    authHeaders: config.authHeaders ?? (() => ({})),
    sources: config.sources ?? DEFAULT_APM_DASHBOARD_SOURCES,
    defaultSource: config.defaultSource ?? 'Portal',
  };
}

/**
 * Registers the Performance Dashboard data layer.
 *
 * - Pass `config` to point at your `GetAPM*` endpoints (and optional auth headers).
 * - Omit `dataProvider` to use the built-in HttpClient implementation, or pass a
 *   custom class to fully control how data is fetched (e.g. delegate to an existing
 *   service). Requires `provideHttpClient()` in the app when using the default.
 */
export function provideApmDashboard(
  config: ApmDashboardConfig,
  dataProvider?: Type<ApmDashboardDataProvider>,
): Provider[] {
  return [
    { provide: APM_DASHBOARD_CONFIG, useValue: normalizeConfig(config) },
    { provide: ApmDashboardDataProvider, useClass: dataProvider ?? HttpApmDashboardDataProvider },
  ];
}
