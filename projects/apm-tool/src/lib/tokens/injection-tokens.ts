import { InjectionToken } from '@angular/core';
import { ApmConfig } from '../interfaces/apm-config.interface';
import { ApmTransport } from '../interfaces/apm-transport.interface';
import { ApmUserProvider } from '../interfaces/apm-user-provider.interface';
import { ApmDeviceDetector } from '../interfaces/apm-device-detector.interface';

export const APM_CONFIG = new InjectionToken<ApmConfig>('APM_CONFIG');
export const APM_TRANSPORT = new InjectionToken<ApmTransport>('APM_TRANSPORT');
export const APM_USER_PROVIDER = new InjectionToken<ApmUserProvider>('APM_USER_PROVIDER');
export const APM_DEVICE_DETECTOR = new InjectionToken<ApmDeviceDetector>('APM_DEVICE_DETECTOR');
