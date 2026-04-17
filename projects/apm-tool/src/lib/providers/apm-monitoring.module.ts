import { NgModule, ModuleWithProviders, ErrorHandler, APP_INITIALIZER, Type } from '@angular/core';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { MonitoringService } from '../services/monitoring.service';
import { RouteMonitoringService } from '../services/route-monitoring.service';
import { MonitoringHttpInterceptor } from '../interceptors/monitoring-http.interceptor';
import { GlobalErrorHandler } from '../handlers/apm-error-handler';
import { APM_CONFIG, APM_TRANSPORT, APM_USER_PROVIDER, APM_DEVICE_DETECTOR } from '../tokens/injection-tokens';
import { ApmConfig } from '../interfaces/apm-config.interface';
import { ApmTransport } from '../interfaces/apm-transport.interface';
import { ApmUserProvider } from '../interfaces/apm-user-provider.interface';
import { ApmDeviceDetector } from '../interfaces/apm-device-detector.interface';
import { DEFAULT_APM_CONFIG, initializeMonitoring } from './apm-monitoring.providers';

export interface ApmModuleOptions {
  config: Partial<ApmConfig>;
  transport: Type<ApmTransport>;
  userProvider?: Type<ApmUserProvider>;
  deviceDetector?: Type<ApmDeviceDetector>;
}

@NgModule({})
export class ApmMonitoringModule {
  static forRoot(options: ApmModuleOptions): ModuleWithProviders<ApmMonitoringModule> {
    const mergedConfig = { ...DEFAULT_APM_CONFIG, ...options.config };

    return {
      ngModule: ApmMonitoringModule,
      providers: [
        { provide: APM_CONFIG, useValue: mergedConfig },
        { provide: APM_TRANSPORT, useClass: options.transport },

        // Optional providers
        ...(options.userProvider ? [
          { provide: APM_USER_PROVIDER, useClass: options.userProvider }
        ] : []),
        ...(options.deviceDetector ? [
          { provide: APM_DEVICE_DETECTOR, useClass: options.deviceDetector }
        ] : []),

        // Core services
        MonitoringService,
        RouteMonitoringService,

        // HTTP Interceptor
        {
          provide: HTTP_INTERCEPTORS,
          useClass: MonitoringHttpInterceptor,
          multi: true
        },

        // Custom Error Handler
        {
          provide: ErrorHandler,
          useClass: GlobalErrorHandler
        },

        // App Initializer
        {
          provide: APP_INITIALIZER,
          useFactory: initializeMonitoring,
          deps: [MonitoringService, RouteMonitoringService, APM_CONFIG],
          multi: true
        }
      ]
    };
  }
}
