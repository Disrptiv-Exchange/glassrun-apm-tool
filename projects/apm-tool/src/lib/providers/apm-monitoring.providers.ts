import { Provider, EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER, ErrorHandler, Type, Optional, Injector, ApplicationRef } from '@angular/core';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { Router } from '@angular/router';
import { MonitoringService } from '../services/monitoring.service';
import { RouteMonitoringService } from '../services/route-monitoring.service';
import { MonitoringHttpInterceptor } from '../interceptors/monitoring-http.interceptor';
import { GlobalErrorHandler } from '../handlers/apm-error-handler';
import { APM_CONFIG, APM_TRANSPORT, APM_USER_PROVIDER, APM_DEVICE_DETECTOR } from '../tokens/injection-tokens';
import { ApmConfig } from '../interfaces/apm-config.interface';
import { ApmTransport } from '../interfaces/apm-transport.interface';
import { ApmUserProvider } from '../interfaces/apm-user-provider.interface';
import { ApmDeviceDetector } from '../interfaces/apm-device-detector.interface';

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
  bufferSize: 100
};

export interface ApmProviderOptions {
  config: Partial<ApmConfig>;
  transport: Type<ApmTransport>;
  userProvider?: Type<ApmUserProvider>;
  deviceDetector?: Type<ApmDeviceDetector>;
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

    // Core services — use useFactory to ensure proper DI context
    {
      provide: MonitoringService,
      useFactory: (transport: ApmTransport, userProvider: ApmUserProvider | null, deviceDetector: ApmDeviceDetector | null, config: ApmConfig) => {
        return new MonitoringService(transport, userProvider, deviceDetector, config);
      },
      deps: [APM_TRANSPORT, [new Optional(), APM_USER_PROVIDER], [new Optional(), APM_DEVICE_DETECTOR], APM_CONFIG]
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

    // Custom Error Handler - TEMPORARILY DISABLED FOR DIAGNOSIS
    // {
    //   provide: ErrorHandler,
    //   useClass: GlobalErrorHandler
    // },

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
