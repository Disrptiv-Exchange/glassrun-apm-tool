import { Provider, EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER, ErrorHandler, Type, Optional, Injector, ApplicationRef } from '@angular/core';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { Router } from '@angular/router';
import { MonitoringService } from '../services/monitoring.service';
import { RouteMonitoringService } from '../services/route-monitoring.service';
import { MonitoringHttpInterceptor } from '../interceptors/monitoring-http.interceptor';
import { GlobalErrorHandler } from '../handlers/apm-error-handler';
import { APM_CONFIG, APM_TRANSPORT, APM_USER_PROVIDER, APM_DEVICE_DETECTOR, APM_ENABLEMENT_GATE } from '../tokens/injection-tokens';
import { ApmConfig } from '../interfaces/apm-config.interface';
import { ApmTransport } from '../interfaces/apm-transport.interface';
import { ApmUserProvider } from '../interfaces/apm-user-provider.interface';
import { ApmDeviceDetector } from '../interfaces/apm-device-detector.interface';
import { ApmEnablementGate } from '../interfaces/apm-enablement-gate.interface';

/**
 * Default APM configuration
 */
export const DEFAULT_APM_CONFIG: ApmConfig = {
  serviceName: 'glassRUN-B2B-App',
  serviceVersion: '1.0.0',
  environment: 'development',
  serverUrl: '',
  active: true,
  sampleRate: 1.0,
  transactionSampleRate: 1.0,
  capturePageLoad: true,
  captureInteractions: true,
  captureErrors: true,
  distributedTracing: true,
  apiRequestTimeout: 30000,
  maxTransactionDuration: 300000,
  maxSpans: 1000,
  flushInterval: 5000,
  bufferSize: 100,
  // 1.0 keeps the previous behaviour - every API call logged. Apps opt into the reduction.
  apiSampleRate: 1.0,
  slowApiThresholdMs: 2000,
  excludedApiPatterns: [],
  maxBufferSize: 1000,
  maxBatchSize: 10
};

export interface ApmProviderOptions {
  config: Partial<ApmConfig>;
  transport: Type<ApmTransport>;
  userProvider?: Type<ApmUserProvider>;
  deviceDetector?: Type<ApmDeviceDetector>;
  /**
   * Opt-in: register GlobalErrorHandler as the app's ErrorHandler so unhandled
   * UI errors are captured. Off by default. The handler resolves MonitoringService
   * lazily (via Injector), so enabling it is safe during bootstrap (no NG0203).
   * Note: setting this overrides any other ErrorHandler the app provides.
   */
  captureUnhandledErrors?: boolean;

  /**
   * Optional. Supplying a gate makes init() register nothing until the gate answers true, so an
   * app whose APM is switched off pays no collection cost at all - not just no network calls.
   * Without one, collection starts at init() as before.
   */
  enablementGate?: Type<ApmEnablementGate>;
}

/**
 * Factory function to initialize monitoring services
 */
export function initializeMonitoring(
  monitoringService: MonitoringService,
  routeMonitoringService: RouteMonitoringService,
  config: ApmConfig
) {
  return () => {
    try {
      monitoringService.init(config);
      routeMonitoringService.init();
    } catch {
      /* Never let APM initialization crash the app */
    }
    return Promise.resolve();
  };
}

/**
 * Build a flat Provider[] array for APM monitoring.
 * Can be spread directly into app providers (same pattern as the original MONITORING_PROVIDERS).
 */
export function getApmProviders(options: ApmProviderOptions): Provider[] {
  const mergedConfig = { ...DEFAULT_APM_CONFIG, ...options.config };

  return [
    { provide: APM_CONFIG, useValue: mergedConfig },
    { provide: APM_TRANSPORT, useClass: options.transport },

    // Optional providers
    ...(options.userProvider ? [
      { provide: APM_USER_PROVIDER, useClass: options.userProvider }
    ] : []),
    ...(options.deviceDetector ? [
      { provide: APM_DEVICE_DETECTOR, useClass: options.deviceDetector }
    ] : []),
    ...(options.enablementGate ? [
      { provide: APM_ENABLEMENT_GATE, useClass: options.enablementGate }
    ] : []),

    // Core services — use useFactory to ensure proper DI context
    {
      provide: MonitoringService,
      useFactory: (transport: ApmTransport, userProvider: ApmUserProvider | null, deviceDetector: ApmDeviceDetector | null, config: ApmConfig, gate: ApmEnablementGate | null) => {
        return new MonitoringService(transport, userProvider, deviceDetector, config, gate);
      },
      deps: [APM_TRANSPORT, [new Optional(), APM_USER_PROVIDER], [new Optional(), APM_DEVICE_DETECTOR], APM_CONFIG, [new Optional(), APM_ENABLEMENT_GATE]]
    },
    {
      provide: RouteMonitoringService,
      useFactory: (router: Router, appRef: ApplicationRef, ms: MonitoringService) => {
        return new RouteMonitoringService(router, appRef, ms);
      },
      deps: [Router, ApplicationRef, MonitoringService]
    },

    // HTTP Interceptor
    {
      provide: HTTP_INTERCEPTORS,
      useClass: MonitoringHttpInterceptor,
      multi: true
    },

    // Custom Error Handler — opt-in via options.captureUnhandledErrors.
    // GlobalErrorHandler resolves MonitoringService lazily, so registering it
    // as ErrorHandler no longer triggers NG0203 at bootstrap.
    ...(options.captureUnhandledErrors ? [
      { provide: ErrorHandler, useClass: GlobalErrorHandler }
    ] : []),

    // App Initializer
    {
      provide: APP_INITIALIZER,
      useFactory: initializeMonitoring,
      deps: [MonitoringService, RouteMonitoringService, APM_CONFIG],
      multi: true
    }
  ];
}

/**
 * Standalone provider function for Angular apps using app.config.ts
 * Uses makeEnvironmentProviders for environment-level registration.
 */
export function provideApmMonitoring(options: ApmProviderOptions): EnvironmentProviders {
  return makeEnvironmentProviders(getApmProviders(options));
}
