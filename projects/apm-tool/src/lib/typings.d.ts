// Zone.js type declarations
declare var Zone: any;
declare type ZoneDelegate = any;

// PerformanceEventTiming (not in all TypeScript libs)
interface PerformanceEventTiming extends PerformanceEntry {
  processingStart: number;
  processingEnd: number;
  cancelable: boolean;
  interactionId?: number;
}

// PerformanceLongTaskTiming
interface PerformanceLongTaskTiming extends PerformanceEntry {
  attribution: any[];
}
declare var PerformanceLongTaskTiming: {
  prototype: PerformanceLongTaskTiming;
  new(): PerformanceLongTaskTiming;
};

// Capacitor module declarations (optional dependencies)
declare module '@capacitor/app' {
  export const App: {
    getInfo(): Promise<{ version: string; build: string; id: string; name: string }>;
  };
}

declare module '@capacitor/device' {
  export const Device: {
    getInfo(): Promise<{
      platform: string;
      manufacturer: string;
      model: string;
      osVersion: string;
      operatingSystem: string;
      isVirtual: boolean;
      memUsed?: number;
      diskFree?: number;
      diskTotal?: number;
      realDiskFree?: number;
      realDiskTotal?: number;
      webViewVersion?: string;
      serial?: string;
    }>;
    getId(): Promise<{ identifier: string }>;
  };
}
