// services/monitoring.service.ts

import { Injectable, Inject, Optional } from '@angular/core';
import { Subject } from 'rxjs';
import { Transaction, Span, TransactionContext, SpanContext } from '../interfaces/monitoring.interfaces';
import { ApmConfig } from '../interfaces/apm-config.interface';
import { ApmTransport } from '../interfaces/apm-transport.interface';
import { ApmUserProvider } from '../interfaces/apm-user-provider.interface';
import { ApmDeviceDetector, ApmBatteryInfo, ApmStorageInfo } from '../interfaces/apm-device-detector.interface';
import { APM_CONFIG, APM_TRANSPORT, APM_USER_PROVIDER, APM_DEVICE_DETECTOR } from '../tokens/injection-tokens';
import { generateUUID } from '../utils/uuid';
import { tryGetCapacitorAppInfo, tryGetCapacitorDeviceInfo } from '../utils/capacitor-helpers';

/** GR-9408: Breadcrumb entry — represents a user action leading up to an error */
export interface Breadcrumb {
  timestamp: number;
  category: 'navigation' | 'http' | 'ui' | 'error' | 'custom';
  message: string;
  data?: Record<string, any>;
}

/** GR-9408: Offline queue entry — wraps a log with queue metadata */
interface OfflineQueueEntry {
  logType: string;
  data: Record<string, unknown>;
  queuedAtMs: number;
}

/** GR-9408: Localstorage keys */
const LS_COLD_START_FLAG = 'apm_cold_start_done';
const LS_OFFLINE_QUEUE = 'apm_offline_queue';

interface ErrorData {
  message: string;
  stack: string | undefined;
  name: string;
  timestamp: number;
  context: any;
  transactionId: string | undefined;
  traceId: string | undefined;
  url: string;
  component: string;
  severity: string;
  category: string;
  state: string | null;
  browserInfo: string;
  type: string;
  resourceUrl?: string;
  resourceType?: string;
  plugin?: string;
  method?: string;
  geoErrorCode?: number;
  geoErrorMessage?: string;
  functionName?: string;
  functionArgs?: string;
  requestUrl?: string;
  requestMethod?: string;
  statusCode?: number;
}

// #8 Code quality: Max entries to keep in memory before trimming
const MAX_TRANSACTIONS = 100;
const MAX_SPANS = 500;

@Injectable()
export class MonitoringService {
  private config: ApmConfig;
  private currentTransaction: Transaction | null = null;
  private transactions: Transaction[] = [];
  private spans: Span[] = [];
  private isInitialized = false;

  private transactionSubject = new Subject<Transaction>();
  private spanSubject = new Subject<Span>();

  public transaction$ = this.transactionSubject.asObservable();
  public span$ = this.spanSubject.asObservable();

  // Web Vitals — single set of observers (FCP/CLS are global, LCP/FID/INP are per-navigation)
  private webVitals: any = {};
  private observers: PerformanceObserver[] = [];
  private readonly ERROR_DEDUPLICATION_WINDOW = 5000; // 5 seconds
  private errorDeduplicationMap = new Map<string, number>();

  // Per-navigation SPA vitals (reset on each route change)
  private latestLCP: number | null = null;
  private latestFID: number | null = null;
  private latestINP: number | null = null;
  private lcpObserver: PerformanceObserver | null = null;
  private fidObserver: PerformanceObserver | null = null;
  private inpObserver: PerformanceObserver | null = null;

  /** Navigation start time (ms, performance.now()); only requests started after this count for "page ready". */
  private navigationStartTime = 0;
  /** requestId -> request start time (performance.now()) for navigation-scoped in-flight count. */
  private inFlightRequests = new Map<string, number>();

  // #1 Batching: buffer for APM logs
  private logBuffer: Record<string, unknown>[] = [];
  private flushTimerId: any = null;

  // #3 Monkey-patching: recursion guard for console override
  private isCapturingConsoleError = false;

  // GR-9408: Breadcrumb ring buffer (recent user actions)
  private breadcrumbs: Breadcrumb[] = [];

  // GR-9408: Cold start tracking
  private coldStartTimeMs: number | null = null;
  private isColdStartSession = false;
  private coldStartReported = false;
  private sessionStartPerfNow = 0;

  // GR-9408: Cached battery/storage info (refreshed periodically for mobile)
  private cachedBatteryInfo: ApmBatteryInfo | null = null;
  private cachedStorageInfo: ApmStorageInfo | null = null;
  private lastBatteryStorageRefresh = 0;
  private readonly BATTERY_STORAGE_REFRESH_INTERVAL = 30000; // 30s

  // GR-9408: Offline queue
  private offlineFlushScheduled = false;

  private async getNetworkInfo(): Promise<{
    networkType: string;
    effectiveType: string;
    downlink: number;
    rtt: number;
    saveData: boolean;
  }> {
    try {
      const connection = (navigator as any).connection ||
                        (navigator as any).mozConnection ||
                        (navigator as any).webkitConnection;

      if (connection) {
        return {
          networkType: connection.type || 'unknown',
          effectiveType: connection.effectiveType || 'unknown',
          downlink: connection.downlink || 0,
          rtt: connection.rtt || 0,
          saveData: connection.saveData || false
        };
      }
    } catch (error) {
      // Failed to get network info - non-critical
    }

    return {
      networkType: 'unknown',
      effectiveType: 'unknown',
      downlink: 0,
      rtt: 0,
      saveData: false
    };
  }

  private async getDeviceInfo(): Promise<{
    platform: string;
    manufacturer: string;
    model: string;
    deviceVersion: string;
    deviceUniqueId: string;
    serial: string;
  }> {
    const isMobileDevice = this.deviceDetector?.isMobile() ?? false;

    if (isMobileDevice) {
      const capInfo = await tryGetCapacitorDeviceInfo();
      if (capInfo) {
        return {
          platform: capInfo.platform,
          manufacturer: capInfo.manufacturer,
          model: capInfo.model,
          deviceVersion: capInfo.osVersion,
          deviceUniqueId: capInfo.identifier,
          serial: capInfo.serial
        };
      }
      return {
        platform: 'android',
        manufacturer: '',
        model: '',
        deviceVersion: '',
        deviceUniqueId: '',
        serial: ''
      };
    } else {
      // For web browsers
      const platform = 'web';
      const manufacturer = navigator?.vendor || 'Unknown';
      const userAgent = navigator.userAgent;
      let model = 'Unknown';
      let deviceVersion = '';

      // Try to determine browser and version
      if (userAgent.includes('Chrome')) {
        model = 'Chrome';
        const match = userAgent.match(/Chrome\/(\d+\.\d+)/);
        deviceVersion = match ? match[1] : '';
      } else if (userAgent.includes('Firefox')) {
        model = 'Firefox';
        const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
        deviceVersion = match ? match[1] : '';
      } else if (userAgent.includes('Safari')) {
        model = 'Safari';
        const match = userAgent.match(/Version\/(\d+\.\d+)/);
        deviceVersion = match ? match[1] : '';
      }

      // Generate a persistent device ID for web
      let deviceId = window.localStorage.getItem('webDeviceId');
      if (!deviceId) {
        deviceId = generateUUID();
        window.localStorage.setItem('webDeviceId', deviceId);
      }

      return {
        platform,
        manufacturer,
        model,
        deviceVersion,
        deviceUniqueId: deviceId,
        serial: ''
      };
    }
  }

  private async ensureDeviceVersionInfo(): Promise<{versionNumber: string, versionCode: string}> {
    const isMobileDevice = this.deviceDetector?.isMobile() ?? false;
    if (!isMobileDevice) {
      return { versionNumber: '', versionCode: '' }; // Not needed for portal
    }

    // Check if version info exists in localStorage
    const storedVersionNo = window.localStorage.getItem("AppVersionNo");
    const storedVersionCode = window.localStorage.getItem("AppBuildNo");

    // If both values exist in localStorage, return them
    if (storedVersionNo && storedVersionCode) {
      return { versionNumber: storedVersionNo, versionCode: storedVersionCode };
    }

    // If either is missing, fetch from device
    try {
      const appInfo = await tryGetCapacitorAppInfo();
      if (!appInfo) {
        return { versionNumber: '', versionCode: '' };
      }

      let versionNumber = appInfo.version || '';
      let versionCode = appInfo.build || '';

      // Only store valid values
      if (versionNumber && versionNumber !== 'N/A') {
        window.localStorage.setItem("AppVersionNo", versionNumber);
      }
      else if(storedVersionNo)
      {
        versionNumber = storedVersionNo;
        window.localStorage.setItem("AppVersionNo", versionNumber);
      }

      if (versionCode && versionCode !== 'N/A') {
        window.localStorage.setItem("AppBuildNo", versionCode);
      }
      else if(storedVersionCode)
      {
        versionCode = storedVersionCode;
        window.localStorage.setItem("AppBuildNo", versionCode);
      }

      return { versionNumber, versionCode };
    } catch (error) {
      // Failed to fetch device version info - non-critical
      return { versionNumber: '', versionCode: '' };
    }
  }

  constructor(
    @Inject(APM_TRANSPORT) private transport: ApmTransport,
    @Optional() @Inject(APM_USER_PROVIDER) private userProvider: ApmUserProvider | null,
    @Optional() @Inject(APM_DEVICE_DETECTOR) private deviceDetector: ApmDeviceDetector | null,
    @Inject(APM_CONFIG) configInput: ApmConfig
  ) {
    this.config = { ...this.getDefaultConfig(), ...configInput };
    // GR-9408: record session start time for cold start calculation
    this.sessionStartPerfNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    this.detectColdStart();
  }

  /**
   * Initialize the monitoring service with configuration.
   * Called by APP_INITIALIZER after DI is complete.
   */
  init(config: Partial<ApmConfig>): void {
    try {
      if (this.isInitialized) return;
      this.config = { ...this.config, ...config };
      this.isInitialized = true;

      this.collectFCP();
      this.collectCLS();
      this.resetWebVitalsObservers();

      this.setupGeolocationErrorHandling();
      this.setupConsoleErrorCapture();

      if ('PerformanceObserver' in window && 'PerformanceLongTaskTiming' in window) {
        (window as any).__apmLongTasks = [];
        try {
          const longTaskObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            (window as any).__apmLongTasks = (window as any).__apmLongTasks.concat(entries.map(e => ({
              name: e.name,
              entryType: e.entryType,
              startTime: e.startTime,
              duration: e.duration
            })));
          });
          longTaskObserver.observe({ entryTypes: ['longtask'] });
        } catch (e) { /* ignore */ }
      }

      if (this.config.active) {
        this.setupGlobalErrorHandling();
        this.setupPerformanceObservers();
        this.startPageLoadTransaction();
        this.startFlushTimer();

        if (typeof window !== 'undefined') {
          window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushBuffer();
          });
          window.addEventListener('beforeunload', () => this.flushBuffer());

          // GR-9408: listen for online event to flush offline queue
          if (this.config.enableOfflineQueue !== false) {
            window.addEventListener('online', () => this.scheduleOfflineQueueFlush());
            // Attempt initial flush if we're online and have queued logs
            if (navigator.onLine) this.scheduleOfflineQueueFlush();
          }
        }
      }

      if ('performance' in window && 'clearResourceTimings' in performance) {
        setInterval(() => performance.clearResourceTimings(), 60000);
      }

      // GR-9408: fire cold start log if applicable (after init completes)
      this.reportColdStartIfNeeded();
    } catch {
      /* Never let APM init crash the app */
    }
  }

  // ====================================================================
  // GR-9408: Cold start detection
  // ====================================================================

  private detectColdStart(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      // Flag is cleared on page unload; if missing, this is a cold start
      const flag = window.localStorage.getItem(LS_COLD_START_FLAG);
      this.isColdStartSession = !flag;
      if (this.isColdStartSession) {
        window.localStorage.setItem(LS_COLD_START_FLAG, '1');
        // Clear the flag on unload so next launch is detected as cold start
        if (typeof window.addEventListener === 'function') {
          window.addEventListener('beforeunload', () => {
            try { window.localStorage.removeItem(LS_COLD_START_FLAG); } catch { /* ignore */ }
          });
        }
      }
    } catch { /* ignore */ }
  }

  private reportColdStartIfNeeded(): void {
    if (!this.isColdStartSession || this.coldStartReported) return;
    // Only track on mobile apps
    const isMobile = this.deviceDetector?.isMobile() ?? false;
    if (!isMobile) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    this.coldStartTimeMs = Math.max(0, now - this.sessionStartPerfNow);
    this.coldStartReported = true;
    this.logPerformanceData('APP_COLD_START', {
      AppColdStartTimeMs: this.coldStartTimeMs,
      IsColdStart: true
    });
  }

  /** Public API: manually report cold start time (if app has a more precise measure from native) */
  public trackColdStart(coldStartMs: number): void {
    if (this.coldStartReported) return;
    this.coldStartTimeMs = coldStartMs;
    this.coldStartReported = true;
    this.logPerformanceData('APP_COLD_START', {
      AppColdStartTimeMs: coldStartMs,
      IsColdStart: true
    });
  }

  // ====================================================================
  // GR-9408: Capacitor plugin call tracking
  // ====================================================================

  /** Call this from your Capacitor adapter wrapper to log plugin call timing. */
  public trackCapacitorPluginCall(pluginName: string, method: string, durationMs: number, success: boolean): void {
    this.logPerformanceData('CAPACITOR_PLUGIN_CALL', {
      PluginName: pluginName,
      PluginMethod: method,
      PluginDurationMs: durationMs,
      PluginSuccess: success
    });
  }

  // ====================================================================
  // GR-9408: Breadcrumbs
  // ====================================================================

  /** Public API: add a custom breadcrumb (e.g., UI click, business action) */
  public addBreadcrumb(category: Breadcrumb['category'], message: string, data?: Record<string, any>): void {
    if (this.config.enableBreadcrumbs === false) return;
    const max = this.config.breadcrumbMaxEntries ?? 20;
    this.breadcrumbs.push({ timestamp: Date.now(), category, message, data });
    if (this.breadcrumbs.length > max) {
      this.breadcrumbs = this.breadcrumbs.slice(-max);
    }
  }

  /** Internal: serialize breadcrumbs for error logs */
  private serializeBreadcrumbs(): string | null {
    if (!this.breadcrumbs.length) return null;
    try { return JSON.stringify(this.breadcrumbs); } catch { return null; }
  }

  // ====================================================================
  // GR-9408: Error fingerprinting
  // ====================================================================

  /** Generate a deterministic fingerprint for error grouping. Strips line numbers, URLs, IDs. */
  private computeErrorFingerprint(errorType: string | undefined, errorMessage: string | undefined): string {
    const type = errorType ?? 'Unknown';
    const msg = errorMessage ?? '';
    // Normalize: strip line:column numbers, URLs, hex hashes, UUIDs, and digits
    const normalized = msg
      .replace(/:\d+:\d+/g, ':L:C')
      .replace(/https?:\/\/[^\s)]+/g, '<url>')
      .replace(/\b[0-9a-f]{32,}\b/gi, '<hash>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
      .replace(/\d{4,}/g, '<n>');
    // Simple DJB2-ish hash for client-side fingerprint
    const source = `${type}|${normalized.substring(0, 500)}`;
    let hash = 5381;
    for (let i = 0; i < source.length; i++) {
      hash = ((hash << 5) + hash) ^ source.charCodeAt(i);
      hash = hash >>> 0; // keep as uint32
    }
    return `${type}:${hash.toString(16)}`;
  }

  // ====================================================================
  // GR-9408: Battery & Storage refresh
  // ====================================================================

  private async refreshBatteryStorage(): Promise<void> {
    const now = Date.now();
    if (now - this.lastBatteryStorageRefresh < this.BATTERY_STORAGE_REFRESH_INTERVAL) return;
    this.lastBatteryStorageRefresh = now;
    try {
      if (this.deviceDetector?.getBatteryInfo) {
        this.cachedBatteryInfo = await this.deviceDetector.getBatteryInfo();
      }
    } catch { this.cachedBatteryInfo = null; }
    try {
      if (this.deviceDetector?.getStorageInfo) {
        this.cachedStorageInfo = await this.deviceDetector.getStorageInfo();
      }
    } catch { this.cachedStorageInfo = null; }
  }

  // ====================================================================
  // GR-9408: Offline queue
  // ====================================================================

  private loadOfflineQueue(): OfflineQueueEntry[] {
    try {
      const raw = window.localStorage.getItem(LS_OFFLINE_QUEUE);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  private saveOfflineQueue(queue: OfflineQueueEntry[]): void {
    try {
      const max = this.config.offlineQueueMaxSize ?? 1000;
      const trimmed = queue.length > max ? queue.slice(-max) : queue;
      window.localStorage.setItem(LS_OFFLINE_QUEUE, JSON.stringify(trimmed));
    } catch { /* quota or serialization issue — drop silently */ }
  }

  private enqueueOffline(logType: string, data: Record<string, unknown>): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const queue = this.loadOfflineQueue();
    queue.push({ logType, data, queuedAtMs: Date.now() });
    this.saveOfflineQueue(queue);
  }

  private scheduleOfflineQueueFlush(): void {
    if (this.offlineFlushScheduled) return;
    this.offlineFlushScheduled = true;
    setTimeout(() => {
      this.offlineFlushScheduled = false;
      this.flushOfflineQueue();
    }, 500);
  }

  private flushOfflineQueue(): void {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const queue = this.loadOfflineQueue();
    if (!queue.length) return;
    const now = Date.now();
    // Mark each entry with offline metadata and push into regular buffer
    for (const entry of queue) {
      const queueDurationMs = now - entry.queuedAtMs;
      const enriched = {
        ...entry.data,
        WasQueuedOffline: true,
        OfflineQueueDurationMs: queueDurationMs
      };
      this.logBuffer.push(enriched);
    }
    this.saveOfflineQueue([]);
    this.flushBuffer();
  }

  /**
   * Start a new transaction
   */
  startTransaction(
    name: string,
    type: 'page-load' | 'route-change' | 'custom' = 'custom',
    context?: TransactionContext
  ): Transaction {
    const transaction: Transaction = {
      id: this.generateId(),
      name,
      type,
      startTime: performance.now(),
      spans: [],
      context: context || {},
      outcome: 'unknown',
      sampled: Math.random() < this.config.transactionSampleRate,
      traceId: this.generateTraceId()
    };

    this.currentTransaction = transaction;
    this.transactions.push(transaction);

    // #2 Memory: trim transactions array to prevent unbounded growth
    if (this.transactions.length > MAX_TRANSACTIONS) {
      this.transactions = this.transactions.slice(-MAX_TRANSACTIONS);
    }

    this.transactionSubject.next(transaction);

    return transaction;
  }

  /**
   * End the current transaction
   */
  endTransaction(outcome: 'success' | 'failure' = 'success'): void {
    if (!this.currentTransaction) return;

    const endTime = performance.now();
    this.currentTransaction.endTime = endTime;
    this.currentTransaction.duration = endTime - this.currentTransaction.startTime;
    this.currentTransaction.outcome = outcome;

    // Add spans to transaction
    this.currentTransaction.spans = this.spans.filter(
      span => span.transactionId === this.currentTransaction!.id
    );

    this.transactionSubject.next(this.currentTransaction);
    this.currentTransaction = null;
  }

  /**
   * Start a new span within the current transaction
   */
  startSpan(
    name: string,
    type: 'http' | 'db' | 'external' | 'custom' = 'custom',
    subtype?: string,
    context?: SpanContext
  ): Span | null {
    if (!this.currentTransaction) return null;

    const span: Span = {
      id: this.generateId(),
      transactionId: this.currentTransaction.id,
      name,
      type,
      subtype,
      startTime: performance.now(),
      context: context || {},
      outcome: 'unknown',
      traceId: this.currentTransaction.traceId
    };

    this.spans.push(span);

    // #2 Memory: trim spans array to prevent unbounded growth
    if (this.spans.length > MAX_SPANS) {
      this.spans = this.spans.slice(-MAX_SPANS);
    }

    this.spanSubject.next(span);

    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, outcome: 'success' | 'failure' = 'success'): void {
    const span = this.spans.find(s => s.id === spanId);
    if (!span) return;

    const endTime = performance.now();
    span.endTime = endTime;
    span.duration = endTime - span.startTime;
    span.outcome = outcome;

    this.spanSubject.next(span);
  }

  /**
   * Get the current active transaction
   */
  getCurrentTransaction(): Transaction | null {
    return this.currentTransaction;
  }

  /**
   * Add custom context to current transaction
   */
  addTransactionContext(context: Partial<TransactionContext>): void {
    if (!this.currentTransaction) return;

    this.currentTransaction.context = {
      ...this.currentTransaction.context,
      ...context
    };
  }

  /**
   * Add custom tags to current transaction
   */
  addTransactionTags(tags: Record<string, string>): void {
    if (!this.currentTransaction) return;

    this.currentTransaction.context.tags = {
      ...this.currentTransaction.context.tags,
      ...tags
    };
  }

  /**
   * Capture an error
   */
  captureError(error: Error, context?: any): void {
    if (!this.config.captureErrors) return;

    // Prepare error data with all necessary context
    const errorData: ErrorData = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      timestamp: Date.now(),
      context,
      transactionId: this.currentTransaction?.id,
      traceId: this.currentTransaction?.traceId,
      url: window.location.href,
      component: context?.component || this.getCurrentComponent(),
      severity: this.determineErrorSeverity(error),
      category: this.categorizeError(error),
      state: context?.state ? JSON.stringify(context.state) : null,
      browserInfo: navigator.userAgent,
      type: context?.type || 'general_error'
    };

    // Add additional context based on error type
    if (context?.type === 'resource_error') {
      errorData.resourceUrl = context.url;
      errorData.resourceType = context.resourceType;
    } else if (context?.type === 'capacitor_error') {
      errorData.plugin = context.plugin;
      errorData.method = context.method;
    } else if (context?.type === 'geolocation_error' || context?.type === 'geolocation_watch_error') {
      errorData.geoErrorCode = context.code;
      errorData.geoErrorMessage = context.message;
    } else if (context?.type === 'function_binding_error') {
      errorData.functionName = context.function;
      errorData.functionArgs = context.arguments;
    } else if (context?.type === 'network_error') {
      errorData.requestUrl = context.url;
      errorData.requestMethod = context.method;
      errorData.statusCode = context.status;
    }

    // Deduplicate errors within a short time window
    const errorKey = `${errorData.type}:${errorData.message}:${errorData.component}`;
    const now = Date.now();
    const lastErrorTime = this.errorDeduplicationMap.get(errorKey);

    if (lastErrorTime && (now - lastErrorTime) < this.ERROR_DEDUPLICATION_WINDOW) {
      // Skip duplicate error within window
      return;
    }
    this.errorDeduplicationMap.set(errorKey, now);

    // #2 Memory: efficient cleanup - only clean when map gets large
    if (this.errorDeduplicationMap.size > 100) {
      this.cleanErrorDeduplicationMap();
    }

    // Log error to APM
    this.logPerformanceData('UIError', {
      ErrorMessage: errorData.message,
      ErrorStack: errorData.stack,
      ErrorType: errorData.type,
      ErrorUrl: errorData.url,
      ErrorComponent: errorData.component,
      ErrorSeverity: errorData.severity,
      ErrorTimestamp: new Date(errorData.timestamp),
      ErrorCount: 1,
      ComponentState: errorData.state,
      BrowserInfo: errorData.browserInfo,
      ErrorCategory: errorData.category,
      ResourceUrl: errorData.resourceUrl,
      ResourceType: errorData.resourceType,
      Plugin: errorData.plugin,
      Method: errorData.method,
      GeoErrorCode: errorData.geoErrorCode,
      GeoErrorMessage: errorData.geoErrorMessage,
      FunctionName: errorData.functionName,
      FunctionArgs: errorData.functionArgs,
      RequestUrl: errorData.requestUrl,
      RequestMethod: errorData.requestMethod,
      StatusCode: errorData.statusCode,
      TransactionId: errorData.transactionId,
      TraceId: errorData.traceId
    });
  }

  private cleanErrorDeduplicationMap(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.errorDeduplicationMap) {
      if (now - timestamp > this.ERROR_DEDUPLICATION_WINDOW) {
        this.errorDeduplicationMap.delete(key);
      }
    }
  }

  private determineErrorType(error: Error, event?: ErrorEvent): string {
    // Check for specific error types
    if (error.message?.includes('CapacitorException')) {
      return 'capacitor_error';
    }
    if (error.message?.includes('is not a function')) {
      return 'function_binding_error';
    }
    if (error instanceof TypeError && error.message?.includes('Failed to fetch')) {
      return 'network_error';
    }
    if (error.name === 'GeolocationPositionError') {
      return 'geolocation_error';
    }
    if (error.message?.includes('Loading chunk')) {
      return 'chunk_load_error';
    }
    if (error.message?.includes('Maximum update depth exceeded')) {
      return 'infinite_update_error';
    }
    if (error.message?.includes('Memory leak')) {
      return 'memory_leak_error';
    }
    if (event?.filename?.includes('polyfills')) {
      return 'polyfill_error';
    }

    // Default to runtime error
    return 'runtime_error';
  }

  private setupConsoleErrorCapture(): void {
    // Store original console methods
    const originalError = console.error;
    const originalWarn = console.warn;
    const self = this;

    // #3 Override console.error with recursion guard
    console.error = function(...args: any[]) {
      // Call original console.error first
      originalError.apply(console, args);

      // #3 Recursion guard: prevent infinite loop if captureError triggers console.error
      if (self.isCapturingConsoleError) return;
      self.isCapturingConsoleError = true;

      try {
        // #6 Only capture actual Error objects, not routine string warnings
        const errorInfo = self.extractErrorInfo(args);
        if (errorInfo) {
          self.captureError(errorInfo.error, {
            type: errorInfo.type,
            component: self.getCurrentComponent(),
            stack: errorInfo.error.stack
          });
        }
      } finally {
        self.isCapturingConsoleError = false;
      }
    };

    // Override console.warn for Capacitor warnings that might indicate errors
    console.warn = function(...args: any[]) {
      // Call original console.warn
      originalWarn.apply(console, args);

      // #3 Recursion guard
      if (self.isCapturingConsoleError) return;
      self.isCapturingConsoleError = true;

      try {
        // Check if this is a Capacitor-related warning
        const warnMessage = args.map(arg => self.stringifyArg(arg)).join(' ');
        if (warnMessage.includes('Capacitor') || warnMessage.includes('Plugin')) {
          self.captureError(new Error(warnMessage), {
            type: 'capacitor_warning',
            component: self.getCurrentComponent()
          });
        }
      } finally {
        self.isCapturingConsoleError = false;
      }
    };
  }

  // #6 Removed: setupZoneErrorCapture() and handleZoneError() — Zone.current.fork() without running code
  // in the forked zone doesn't intercept errors from Angular's existing zone

  private extractErrorInfo(args: any[]): { error: Error; type: string } | null {
    // #6 Only capture actual Error objects from console.error, not routine string messages
    for (const arg of args) {
      if (arg instanceof Error) {
        return {
          error: arg,
          type: this.determineErrorType(arg)
        };
      }
    }
    // Skip string-only console.error calls (routine library warnings, Angular internals)
    return null;
  }

  private stringifyArg(arg: any): string {
    if (arg instanceof Error) {
      return arg.message;
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }

  getCurrentComponent(): string {
    try {
      const route = window.location.pathname;
      const segments = route.split('/').filter(Boolean);
      return segments[segments.length - 1] || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private determineErrorSeverity(error: Error): string {
    if (error instanceof TypeError || error instanceof ReferenceError) {
      return 'Critical';
    }
    if (error instanceof SyntaxError) {
      return 'High';
    }
    if (error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('http')) {
      return 'Medium';
    }
    return 'Low';
  }

  private categorizeError(error: Error): string {
    if (error instanceof TypeError) {
      return 'Type Error';
    }
    if (error instanceof ReferenceError) {
      return 'Reference Error';
    }
    if (error instanceof SyntaxError) {
      return 'Syntax Error';
    }
    if (error instanceof RangeError) {
      return 'Range Error';
    }
    if (error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('http')) {
      return 'Network Error';
    }
    if (error.message?.toLowerCase().includes('memory')) {
      return 'Memory Error';
    }
    if (error.message?.toLowerCase().includes('timeout')) {
      return 'Timeout Error';
    }
    return 'Other';
  }

  /**
   * Get all completed transactions
   */
  getTransactions(): Transaction[] {
    return this.transactions.filter(t => t.endTime !== undefined);
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.transactions = [];
    this.spans = [];
    this.currentTransaction = null;
  }

  private getDefaultConfig(): ApmConfig {
    return {
      serviceName: 'angular-app',
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
      apiRequestTimeout: 10000,
      maxTransactionDuration: 60000,
      maxSpans: 500,
      flushInterval: 5000,
      bufferSize: 100
    };
  }

  private setupGeolocationErrorHandling(): void {
    if ('geolocation' in navigator) {
      const originalGetCurrentPosition = navigator.geolocation.getCurrentPosition;
      const originalWatchPosition = navigator.geolocation.watchPosition;

      navigator.geolocation.getCurrentPosition = (success, error, options) => {
        const wrappedError = (err: GeolocationPositionError) => {
          if (error) error(err);
          this.captureError(new Error('Geolocation error'), {
            type: 'geolocation_error',
            code: err.code,
            message: err.message,
            component: this.getCurrentComponent()
          });
        };
        return originalGetCurrentPosition.call(navigator.geolocation, success, wrappedError, options);
      };

      navigator.geolocation.watchPosition = (success, error, options) => {
        const wrappedError = (err: GeolocationPositionError) => {
          if (error) error(err);
          this.captureError(new Error('Geolocation watch error'), {
            type: 'geolocation_watch_error',
            code: err.code,
            message: err.message,
            component: this.getCurrentComponent()
          });
        };
        return originalWatchPosition.call(navigator.geolocation, success, wrappedError, options);
      };
    }
  }

  // #3 Removed: setupFunctionBindingErrorHandling() — overriding Function.prototype.bind is extremely
  // dangerous as it wraps EVERY .bind() call in the entire application including Angular internals,
  // zone.js, and third-party libs. Any error in the wrapper crashes the whole bind chain.

  private setupGlobalErrorHandling(): void {
    // Global error handler for all errors including 404s and network errors
    window.addEventListener('error', (event: ErrorEvent | Event) => {
      // Handle image loading errors
      if (event.target instanceof HTMLImageElement) {
        this.captureError(new Error(`Image load failed: ${event.target.src}`), {
          type: 'resource_error',
          resourceType: 'image',
          url: event.target.src,
          component: this.getCurrentComponent()
        });
        return;
      }

      // Handle script/resource loading errors
      if (event.target instanceof HTMLScriptElement) {
        this.captureError(new Error(`Script load failed: ${event.target.src}`), {
          type: 'resource_error',
          resourceType: 'script',
          url: event.target.src,
          component: this.getCurrentComponent()
        });
        return;
      }

      if (event.target instanceof HTMLLinkElement) {
        this.captureError(new Error(`Resource load failed: ${event.target.href}`), {
          type: 'resource_error',
          resourceType: 'link',
          url: event.target.href,
          component: this.getCurrentComponent()
        });
        return;
      }

      // Handle general JavaScript errors
      if (event instanceof ErrorEvent) {
        const error = event.error || new Error(event.message);
        const errorType = this.determineErrorType(error, event);

        this.captureError(error, {
          type: errorType,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          component: this.getCurrentComponent(),
          originalError: error
        });
      }
    }, true); // Use capture phase to catch all errors

    // Enhanced unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      const errorContext: any = {
        component: this.getCurrentComponent(),
        originalError: error
      };

      // Determine error type and context
      if (error.message?.includes('CapacitorException')) {
        errorContext.type = 'capacitor_error';
        errorContext.plugin = 'Capacitor';
        errorContext.method = error.stack?.split('\n')[1]?.trim() || 'unknown';
        // Extract additional Capacitor context
        try {
          const capError = JSON.parse(error.message);
          errorContext.code = capError.code;
          errorContext.platform = capError.platform;
        } catch {}
      }
      else if (error.message?.includes('is not a function')) {
        errorContext.type = 'function_binding_error';
        const matches = error.message.match(/([\w\.]+) is not a function/);
        errorContext.functionName = matches ? matches[1] : 'unknown';
        errorContext.stack = error.stack;
      }
      else if (error instanceof TypeError && error.message?.includes('Failed to fetch')) {
        errorContext.type = 'network_error';
        errorContext.url = error.stack?.match(/at\s+(https?:\/\/[^\s]+)/)?.[1] || 'unknown';
        errorContext.status = 'ERR_CONNECTION_FAILED';
      }
      else if (error.name === 'GeolocationPositionError') {
        errorContext.type = 'geolocation_error';
        errorContext.code = (error as any).code;
        errorContext.message = error.message;
      }
      else {
        errorContext.type = 'unhandled_rejection';
        errorContext.stack = error.stack;
      }

      this.captureError(error, errorContext);
    });

    // Add error boundary for React/Angular components
    window.addEventListener('error', (event) => {
      if (event.error?.['ngDebugContext'] || event.error?.['componentStack']) {
        this.captureError(event.error, {
          type: 'component_error',
          component: this.getCurrentComponent(),
          componentStack: event.error['componentStack'] || event.error['ngDebugContext']?.toString(),
          originalError: event.error
        });
      }
    });
  }

  private setupPerformanceObservers(): void {
    // Performance observer for navigation timing
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach(entry => {
            if (entry.entryType === 'navigation') {
              this.handleNavigationTiming(entry as PerformanceNavigationTiming);
            } else if (entry.entryType === 'paint') {
              this.handlePaintTiming(entry);
            } else if (entry.entryType === 'resource') {
              this.handleResourceTiming(entry as PerformanceResourceTiming);
            }
          });
        });

        observer.observe({ entryTypes: ['navigation', 'paint', 'resource'] });
      } catch (e) {
        // PerformanceObserver not supported
      }
    }
  }

  private handleNavigationTiming(entry: PerformanceNavigationTiming): void {
    if (this.currentTransaction && this.currentTransaction.type === 'page-load') {
      this.currentTransaction.context.custom = {
        ...this.currentTransaction.context.custom,
        navigationTiming: {
          domContentLoaded: entry.domContentLoadedEventEnd - entry.domContentLoadedEventStart,
          domInteractive: entry.domInteractive - entry.startTime,
          domComplete: entry.domComplete - entry.startTime,
          loadEventEnd: entry.loadEventEnd - entry.startTime,
          firstByte: entry.responseStart - entry.startTime,
          dnsLookup: entry.domainLookupEnd - entry.domainLookupStart,
          tcpConnect: entry.connectEnd - entry.connectStart,
          request: entry.responseStart - entry.requestStart,
          response: entry.responseEnd - entry.responseStart
        }
      };
    }
  }

  private handlePaintTiming(entry: PerformanceEntry): void {
    if (this.currentTransaction && this.currentTransaction.type === 'page-load') {
      const paintMetrics = this.currentTransaction.context.custom?.['paintTiming'] || {};

      if (entry.name === 'first-paint') {
        paintMetrics.firstPaint = entry.startTime;
      } else if (entry.name === 'first-contentful-paint') {
        paintMetrics.firstContentfulPaint = entry.startTime;
      }

      this.currentTransaction.context.custom = {
        ...this.currentTransaction.context.custom,
        ['paintTiming']: paintMetrics
      };
    }
  }

  private handleResourceTiming(entry: PerformanceResourceTiming): void {
    // Create spans for significant resources
    if (this.currentTransaction && entry.duration > 10) { // Only track resources taking more than 10ms
      const span = this.startSpan(
        `Resource: ${entry.name}`,
        'external',
        entry.initiatorType,
        {
          custom: {
            url: entry.name,
            duration: entry.duration,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize
          }
        }
      );

      if (span) {
        span.startTime = entry.startTime;
        span.endTime = entry.startTime + entry.duration;
        span.duration = entry.duration;
        span.outcome = 'success';
      }
    }
  }

  private startPageLoadTransaction(): void {
    if (!this.config.capturePageLoad) return;

    const transaction = this.startTransaction(
      `${window.location.pathname}`,
      'page-load',
      {
        page: {
          url: window.location.href,
          referer: document.referrer
        }
      }
    );

    // End transaction when page is fully loaded
    if (document.readyState === 'complete') {
      setTimeout(() => this.endTransaction('success'), 0);
    } else {
      window.addEventListener('load', () => {
        setTimeout(() => this.endTransaction('success'), 100);
      });
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private generateTraceId(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  // ==================== #1 BATCHING ====================

  /**
   * Start the periodic flush timer based on config.flushInterval
   */
  private startFlushTimer(): void {
    if (this.flushTimerId) {
      clearInterval(this.flushTimerId);
    }
    const interval = this.config.flushInterval || 5000;
    this.flushTimerId = setInterval(() => {
      this.flushBuffer();
    }, interval);
  }

  /**
   * Add a log entry to the buffer. Flush when buffer reaches bufferSize.
   */
  private addToBuffer(log: Record<string, unknown>): void {
    this.logBuffer.push(log);
    if (this.logBuffer.length >= (this.config.bufferSize || 100)) {
      this.flushBuffer();
    }
  }

  /**
   * Flush all buffered logs to the transport in a single batch call.
   */
  private flushBuffer(): void {
    if (this.logBuffer.length === 0) return;

    // GR-9408: if offline, move buffer to offline queue instead of dropping
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (this.config.enableOfflineQueue !== false) {
        const batch = this.logBuffer.splice(0);
        for (const log of batch) {
          this.enqueueOffline(String(log['LogType'] ?? 'unknown'), log);
        }
      }
      return;
    }

    const batch = this.logBuffer.splice(0);
    try {
      if (batch.length === 1) {
        // Single log — use existing send method for backward compatibility
        this.transport.send(batch[0]['LogType'] as string || 'unknown', batch[0]);
      } else {
        // Batch — use sendBatch
        this.transport.sendBatch(batch);
      }
    } catch {
      /* Never let APM logging block or crash the application */
    }
  }

  // ==================== END BATCHING ====================

  /**
   * Build a flat APM log object for DB
   */
  private async buildApmLogObject(logType: string, context: any = {}): Promise<any> {
    // Helper: convert to integer for bigint database columns (Performance API returns floats)
    const toInt = (val: number | null | undefined): number | null => {
      if (val == null || typeof val !== 'number' || isNaN(val)) return null;
      return Math.round(val);
    };

    // User/session/environment
    let userInfo = null;
    try {
      userInfo = this.userProvider?.getUserInfo() ?? null;
    } catch { userInfo = null; }

    const userId = userInfo?.userId || null;
    const roleId = userInfo?.roleId || null;
    const sessionId = userInfo?.sessionId || null;
    const environmentName = this.config.production ? 'prod' : 'dev';

    // Performance metrics
    let perfMetrics = null;
    try {
      perfMetrics = this.collectPerformanceMetrics();
    } catch { perfMetrics = null; }
    const nav = perfMetrics?.navigationTiming || {};
    const paint = perfMetrics?.paintTiming || {};
    const vitals = perfMetrics?.vitals || {};
    const derived = this.getDerivedMetrics();

    // API context (for API logs)
    const apiUrl = context.apiUrl || context.url || null;
    const apiMethod = context.apiMethod || context.method || null;
    const apiStatusCode = context.apiStatusCode || context.status || null;
    const jsDurationMs = context.jsDurationMs || (typeof context.jsDuration === 'number' ? context.jsDuration : null);
    // For API_CALL, prefer httpDurationMs from resource timing; fallback to jsDurationMs when null so dashboard has a usable duration
    const rawHttpMs = context.httpDurationMs ?? (typeof context.httpDuration === 'number' ? context.httpDuration : null);
    const httpDurationMs = logType === 'API_CALL' && (rawHttpMs == null || rawHttpMs === '') && typeof jsDurationMs === 'number'
      ? jsDurationMs
      : rawHttpMs;

    // Navigation context
    const navigationFrom = context.navigationFrom || context.from || null;
    const navigationTo = context.navigationTo || context.to || null;
    const navigationTrigger = context.navigationTrigger || context.trigger || null;
    const navigationId = context.navigationId || context.id || 0;
    const navigationDurationMs = context.navigationDurationMs || context.navigationDuration || 0;
    const totalPageLoadTimeMs = context.totalPageLoadTimeMs || context.pageLoadTime || derived['pageLoadTime'] || 0;
    const firstContentfulPaintMs = context.firstContentfulPaintMs || paint.firstContentfulPaint || vitals.fcp || 0;
    const inp = context.inp || vitals.inp || 0;

    // Timing breakdowns: for API_CALL use per-request values from context when present; otherwise fall back to page-level nav
    const fromNav = {
      dnsMs: nav.domainLookupEnd && nav.domainLookupStart ? nav.domainLookupEnd - nav.domainLookupStart : null,
      tcpMs: nav.connectEnd && nav.connectStart ? nav.connectEnd - nav.connectStart : null,
      sslMs: nav.secureConnectionStart && nav.connectEnd && nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : null,
      requestSentMs: nav.requestStart && nav.connectEnd ? nav.requestStart - nav.connectEnd : null,
      ttfbMs: nav.responseStart && nav.requestStart ? nav.responseStart - nav.requestStart : null,
      responseDownloadMs: nav.responseEnd && nav.responseStart ? nav.responseEnd - nav.responseStart : null
    };
    // For API_CALL use context values; if null/empty (e.g. cross-origin restricted timing) send null, do not use page nav
    const dnsMs = logType === 'API_CALL' ? (context.dnsMs != null && context.dnsMs !== '' ? context.dnsMs : null) : fromNav.dnsMs;
    const tcpMs = logType === 'API_CALL' ? (context.tcpMs != null && context.tcpMs !== '' ? context.tcpMs : null) : fromNav.tcpMs;
    const sslMs = logType === 'API_CALL' ? (context.sslMs != null && context.sslMs !== '' ? context.sslMs : null) : fromNav.sslMs;
    const requestSentMs = logType === 'API_CALL' ? (context.requestSentMs != null && context.requestSentMs !== '' ? context.requestSentMs : null) : fromNav.requestSentMs;
    const ttfbMs = logType === 'API_CALL' ? (context.ttfbMs != null && context.ttfbMs !== '' ? context.ttfbMs : null) : fromNav.ttfbMs;
    const responseDownloadMs = logType === 'API_CALL' ? (context.responseDownloadMs != null && context.responseDownloadMs !== '' ? context.responseDownloadMs : null) : fromNav.responseDownloadMs;
    // APITimeInMS = responseEnd - requestStart (pure HTTP lifecycle, excludes DNS/TCP/SSL) - only from Performance API, no fallback
    const apiTimeInMs = context.APITimeInMS ?? null;

    // Error context
    const errorMessage = context.ErrorMessage || context.errorMessage || context.error || null;
    const errorStack = context.ErrorStack || context.errorStack || context.errorStackTrace || null;
    const errorType = context.ErrorType || context.errorType || context.name || null;
    const errorUrl = context.ErrorUrl || context.errorUrl || context.url || null;

    // Device/Network Info
    const userAgent = navigator.userAgent || null;
    let deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop';
    const viewportWidth = window.innerWidth || null;
    const viewportHeight = window.innerHeight || null;
    const browserNetworkInfo = (navigator as any).connection || {};
    const memoryUsedMB = (performance as any).memory && (performance as any).memory.usedJSHeapSize
      ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024)
      : null;

    // Long Tasks: only meaningful for PageNavigation (main thread blocking during page load)
    // For API_CALL, long tasks are not API-specific, so set to null
    let longTaskCount = null;
    let longestLongTaskMs = null;
    let totalLongTaskTimeMs = null;
    if (logType === 'PageNavigation' && (window as any).__apmLongTasks) {
      longTaskCount = (window as any).__apmLongTasks.length;
      longestLongTaskMs = (window as any).__apmLongTasks.length > 0 ? Math.max(...(window as any).__apmLongTasks.map((t: any) => t.duration)) : null;
      totalLongTaskTimeMs = (window as any).__apmLongTasks.reduce((sum: number, t: any) => sum + t.duration, 0);
      // Reset after PageNavigation log (not after API_CALL)
      (window as any).__apmLongTasks = [];
    }

    // API Request Size
    const apiRequestSize = context.ApiRequestSize || context.apiRequestSize || (context.requestBody ? JSON.stringify(context.requestBody).length : null);

    // SPA LCP/FID/INP (per navigation)
    const largestContentfulPaintMs = this.latestLCP || context.LargestContentfulPaintMs || context.largestContentfulPaintMs || (this.webVitals.lcp || null);
    const firstInputDelayMs = this.latestFID || context.FirstInputDelayMs || context.firstInputDelayMs || null;
    const interactionToNextPaintMs = this.latestINP || context.InteractionToNextPaintMs || context.interactionToNextPaintMs || null;

    // For API_CALL: use current page URL (window.location.href), not initial page load URL (nav.pageUrl)
    const currentPath = navigationTo || window.location.href || '';
    const cleanPath = currentPath.split('?')[0].split('#')[0];
    const segments = cleanPath.split('/').filter(segment => segment);
    const urllastSegment = segments[segments.length - 1] || '';

    const isMobileDevice = this.deviceDetector?.isMobile() ?? false;
    let source = this.config.source || "Portal";

    // Get version info
    const { versionNumber: deviceVersionNumber, versionCode: deviceVersionCode } = await this.ensureDeviceVersionInfo();

    // Get device info
    const { platform, manufacturer, model, deviceVersion, deviceUniqueId, serial } = await this.getDeviceInfo();

    // Get network info
    const { networkType, effectiveType, downlink, rtt, saveData } = await this.getNetworkInfo();

    if(isMobileDevice) {
      deviceType = 'Mobile';
      source = this.config.mobileSource || "CustomerAPP_V14";
    } else {
      deviceType = 'Desktop';
      source = this.config.source || "Portal";
    }

    const environmentCode = window.localStorage.getItem("EnvironmentCode") || '4605';

    // Flat log object
    return {
      LogType: logType,
      PageUrl: urllastSegment,
      UserId: userId,
      RoleId: roleId,
      Source: source,
      AppType: this.config.appType || '4605',
      SessionId: sessionId,
      Environment: environmentName,
      DeviceVersionNumber: deviceVersionNumber,
      DeviceVersionCode: deviceVersionCode,
      Timestamp: new Date().toISOString(),
      NavigationFrom: navigationFrom,
      NavigationTo: navigationTo,
      NavigationTrigger: navigationTrigger,
      NavigationId: navigationId,
      NavigationDurationMs: navigationDurationMs,
      TotalPageLoadTimeMs: totalPageLoadTimeMs,
      FirstContentfulPaintMs: firstContentfulPaintMs,
      INP: inp,
      ApiUrl: apiUrl,
      ApiMethod: apiMethod,
      ApiStatusCode: apiStatusCode,
      JsDurationMs: jsDurationMs,
      HttpDurationMs: httpDurationMs,
      APITimeInMS: apiTimeInMs,
      DnsMs: dnsMs,
      TcpMs: tcpMs,
      SslMs: sslMs,
      RequestSentMs: requestSentMs,
      TtfbMs: ttfbMs,
      ResponseDownloadMs: responseDownloadMs,
      ...(logType === 'API_CALL' ? {
        FetchStart: toInt(context.resourceTiming?.fetchStart),
        DomainLookupStart: toInt(context.resourceTiming?.domainLookupStart),
        DomainLookupEnd: toInt(context.resourceTiming?.domainLookupEnd),
        ConnectStart: toInt(context.resourceTiming?.connectStart),
        ConnectEnd: toInt(context.resourceTiming?.connectEnd),
        RequestStart: toInt(context.resourceTiming?.requestStart),
        ResponseStart: toInt(context.resourceTiming?.responseStart),
        ResponseEnd: toInt(context.resourceTiming?.responseEnd),
        ResourceTimingAvailable: context.resourceTimingAvailable ?? false,
        ResourceTimingRestricted: context.resourceTiming?.isRestricted ?? null
      } : {
        NavigationStart: toInt(context.NavigationStart ?? (context.isSpaRouteChange ? null : nav.navigationStart)),
        UnloadEventStart: toInt(context.UnloadEventStart ?? (context.isSpaRouteChange ? null : nav.unloadEventStart)),
        UnloadEventEnd: toInt(context.UnloadEventEnd ?? (context.isSpaRouteChange ? null : nav.unloadEventEnd)),
        RedirectStart: toInt(context.RedirectStart ?? (context.isSpaRouteChange ? null : nav.redirectStart)),
        RedirectEnd: toInt(context.RedirectEnd ?? (context.isSpaRouteChange ? null : nav.redirectEnd)),
        FetchStart: toInt(context.FetchStart ?? (context.isSpaRouteChange ? null : nav.fetchStart)),
        DomainLookupStart: toInt(context.DomainLookupStart ?? (context.isSpaRouteChange ? null : nav.domainLookupStart)),
        DomainLookupEnd: toInt(context.DomainLookupEnd ?? (context.isSpaRouteChange ? null : nav.domainLookupEnd)),
        ConnectStart: toInt(context.ConnectStart ?? (context.isSpaRouteChange ? null : nav.connectStart)),
        ConnectEnd: toInt(context.ConnectEnd ?? (context.isSpaRouteChange ? null : nav.connectEnd)),
        RequestStart: toInt(context.RequestStart ?? (context.isSpaRouteChange ? null : nav.requestStart)),
        ResponseStart: toInt(context.ResponseStart ?? (context.isSpaRouteChange ? null : nav.responseStart)),
        ResponseEnd: toInt(context.ResponseEnd ?? (context.isSpaRouteChange ? null : nav.responseEnd)),
        IsSpaRouteChange: context.isSpaRouteChange ?? false
      }),
      // Error context fields
      ErrorMessage: errorMessage,
      ErrorStack: errorStack,
      ErrorType: errorType,
      ErrorUrl: errorUrl,
      // Device/Network Info
      UserAgent: userAgent,
      DeviceType: deviceType,
      ViewportWidth: viewportWidth,
      ViewportHeight: viewportHeight,
      NetworkType: networkType,
      Downlink: downlink,
      MemoryUsedMB: memoryUsedMB,
      // Long Tasks
      LongTaskCount: longTaskCount,
      LongestLongTaskMs: longestLongTaskMs,
      TotalLongTaskTimeMs: totalLongTaskTimeMs,
      // API Request Size
      ApiRequestSize: apiRequestSize,
      // LCP
      LargestContentfulPaintMs: largestContentfulPaintMs,
      FirstInputDelayMs: firstInputDelayMs,
      InteractionToNextPaintMs: interactionToNextPaintMs,
      EnvironmentCode: environmentCode,
      Platform: platform,
      Manufacturer: manufacturer,
      Model: model,
      DeviceVersion: deviceVersion,
      DeviceUniqueId: deviceUniqueId,
      Serial: serial,
      ConnectionType: networkType,
      NetworkEffectiveType: effectiveType,
      NetworkDownlinkSpeed: downlink,
      NetworkRTT: rtt,
      NetworkSaveData: saveData,
      // GR-9408: new fields
      ReleaseVersion: this.config.releaseVersion ?? null,
      // Battery & storage (mobile only, cached with periodic refresh)
      BatteryLevel: this.cachedBatteryInfo?.level ?? null,
      IsCharging: this.cachedBatteryInfo?.isCharging ?? null,
      FreeDiskSpaceMB: this.cachedStorageInfo?.freeMB ?? null,
      TotalDiskSpaceMB: this.cachedStorageInfo?.totalMB ?? null,
      // Cold start flag (true only on the very first log of a cold-started session)
      IsColdStart: (logType === 'APP_COLD_START') || (context.IsColdStart === true) || null,
      AppColdStartTimeMs: context.AppColdStartTimeMs ?? null,
      // Plugin call fields (populated only for CAPACITOR_PLUGIN_CALL logs)
      PluginName: context.PluginName ?? null,
      PluginMethod: context.PluginMethod ?? null,
      PluginDurationMs: context.PluginDurationMs ?? null,
      PluginSuccess: context.PluginSuccess ?? null,
      // Breadcrumbs: only attached to error logs
      Breadcrumbs: logType === 'UIError' ? this.serializeBreadcrumbs() : null,
      // Error fingerprint: computed for error logs
      ErrorFingerprint: logType === 'UIError'
        ? this.computeErrorFingerprint(context.ErrorType ?? errorType, context.ErrorMessage ?? errorMessage)
        : null
      // NOTE: WasQueuedOffline and OfflineQueueDurationMs are added by flushOfflineQueue() when flushing,
      // so we don't set them here (they're null by default for online-sent logs)
    };
  }

  /**
   * Log the first page load time using the Navigation Timing API
   * Call this from AppComponent (or root component) after app is stable
   */
  public logFirstPageLoad(): void {
    let loadTime = 0;
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      const navEntry = navEntries[0];
      loadTime = navEntry.loadEventEnd - navEntry.startTime;
    } else if (performance.timing) {
      const timing = performance.timing;
      loadTime = timing.loadEventEnd - timing.navigationStart;
    }

    this.logPerformanceData('PageLoad', { TotalPageLoadTimeMs: loadTime, NavigationDurationMs: loadTime });
  }

  async logPerformanceData(logType: string, logObj: any) {
    try {
      // GR-9408: refresh battery/storage info (throttled to 30s) before building log
      this.refreshBatteryStorage();

      const standardizedLog = await this.buildApmLogObject(logType, logObj);
      if (logObj && typeof logObj.TotalPageLoadTimeMs === 'number') {
        standardizedLog.TotalPageLoadTimeMs = logObj.TotalPageLoadTimeMs;
      }

      // #1 Batching: add to buffer (flushed every flushInterval or at bufferSize)
      // GR-9408: even if offline, we add to buffer — flushBuffer() will route to offline queue
      this.addToBuffer(standardizedLog);
    } catch {
      /* Never let APM logging block or crash the application */
    }
  }

  // Performance metrics collection methods
  collectPerformanceMetrics(): any {
    return {
      navigationTiming: this.getNavigationTiming(),
      paintTiming: this.getPaintTiming(),
      resourceTiming: this.getResourceTiming(),
      vitals: this.getWebVitals(),
    };
  }
  private getNavigationTiming(): any {
    if ('performance' in window && 'getEntriesByType' in performance) {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navEntries.length > 0) {
        const nav = navEntries[0];
        const valueOrNull = (val: number): number | null => (val > 0 ? val : null);
        return {
          navigationStart: 0,
          unloadEventStart: valueOrNull(nav.unloadEventStart),
          unloadEventEnd: valueOrNull(nav.unloadEventEnd),
          redirectStart: valueOrNull(nav.redirectStart),
          redirectEnd: valueOrNull(nav.redirectEnd),
          fetchStart: nav.fetchStart,
          domainLookupStart: nav.domainLookupStart,
          domainLookupEnd: nav.domainLookupEnd,
          connectStart: nav.connectStart,
          connectEnd: nav.connectEnd,
          secureConnectionStart: valueOrNull(nav.secureConnectionStart),
          requestStart: nav.requestStart,
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          domInteractive: nav.domInteractive,
          domContentLoadedEventStart: nav.domContentLoadedEventStart,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          domComplete: nav.domComplete,
          loadEventStart: nav.loadEventStart,
          loadEventEnd: nav.loadEventEnd,
          pageUrl: nav.name || window.location.href,
          navigationType: nav.type,
          isInitialPageLoad: true
        };
      }
    }
    if (performance.timing) {
      const timing = performance.timing;
      const navStart = timing.navigationStart || 0;
      const toRelative = (val: number): number | null => {
        if (!val || val <= 0) return null;
        const relative = val - navStart;
        return relative > 0 ? relative : null;
      };
      return {
        navigationStart: 0,
        unloadEventStart: toRelative(timing.unloadEventStart),
        unloadEventEnd: toRelative(timing.unloadEventEnd),
        redirectStart: toRelative(timing.redirectStart),
        redirectEnd: toRelative(timing.redirectEnd),
        fetchStart: toRelative(timing.fetchStart) ?? 0,
        domainLookupStart: toRelative(timing.domainLookupStart),
        domainLookupEnd: toRelative(timing.domainLookupEnd),
        connectStart: toRelative(timing.connectStart),
        connectEnd: toRelative(timing.connectEnd),
        secureConnectionStart: toRelative(timing.secureConnectionStart),
        requestStart: toRelative(timing.requestStart),
        responseStart: toRelative(timing.responseStart),
        responseEnd: toRelative(timing.responseEnd),
        domInteractive: toRelative(timing.domInteractive),
        domContentLoadedEventStart: toRelative(timing.domContentLoadedEventStart),
        domContentLoadedEventEnd: toRelative(timing.domContentLoadedEventEnd),
        domComplete: toRelative(timing.domComplete),
        loadEventStart: toRelative(timing.loadEventStart),
        loadEventEnd: toRelative(timing.loadEventEnd),
        pageUrl: window.location.href,
        navigationType: 'unknown',
        isInitialPageLoad: true
      };
    }
    return { isInitialPageLoad: false };
  }
  private getPaintTiming(): any {
    const paintMetrics: any = {};
    if ('performance' in window && 'getEntriesByType' in performance) {
      const paintEntries = performance.getEntriesByType('paint');
      paintEntries.forEach(entry => {
        if (entry.name === 'first-paint') {
          paintMetrics.firstPaint = entry.startTime;
        } else if (entry.name === 'first-contentful-paint') {
          paintMetrics.firstContentfulPaint = entry.startTime;
        }
      });
      if (this.webVitals.lcp) {
        paintMetrics.largestContentfulPaint = this.webVitals.lcp;
      }
    }
    return paintMetrics;
  }
  private getResourceTiming(): any[] {
    if (!('performance' in window && 'getEntriesByType' in performance)) {
      return [];
    }
    const resourceEntries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resourceEntries.map(entry => ({
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
      decodedBodySize: entry.decodedBodySize || 0
    }));
  }
  private getWebVitals(): any {
    return { ...this.webVitals };
  }
  private getDerivedMetrics(): Record<string, number> {
    if ('performance' in window && 'getEntriesByType' in performance) {
      const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navEntries.length > 0) {
        const nav = navEntries[0];
        return {
          ttfb: nav.responseStart,
          dnsTime: nav.domainLookupEnd - nav.domainLookupStart,
          tcpTime: nav.connectEnd - nav.connectStart,
          requestTime: nav.responseStart - nav.requestStart,
          responseTime: nav.responseEnd - nav.responseStart,
          domProcessingTime: nav.domComplete - nav.domInteractive,
          domContentLoadedTime: nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart,
          loadEventTime: nav.loadEventEnd - nav.loadEventStart,
          pageLoadTime: nav.loadEventEnd,
          domInteractiveTime: nav.domInteractive,
          domCompleteTime: nav.domComplete
        };
      }
    }
    if (performance.timing) {
      const timing = performance.timing;
      const navigationStart = timing.navigationStart;
      return {
        ttfb: timing.responseStart - navigationStart,
        dnsTime: timing.domainLookupEnd - timing.domainLookupStart,
        tcpTime: timing.connectEnd - timing.connectStart,
        requestTime: timing.responseStart - timing.requestStart,
        responseTime: timing.responseEnd - timing.responseStart,
        domProcessingTime: timing.domComplete - (timing.domLoading || timing.domInteractive),
        domContentLoadedTime: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
        loadEventTime: timing.loadEventEnd - timing.loadEventStart,
        pageLoadTime: timing.loadEventEnd - navigationStart,
        domInteractiveTime: timing.domInteractive - navigationStart,
        domCompleteTime: timing.domComplete - navigationStart
      };
    }
    return {};
  }

  // #4 Consolidated Web Vitals: FCP and CLS are global (one observer each, never reset)
  private collectFCP(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach(entry => {
          if (entry.name === 'first-contentful-paint') {
            this.webVitals.fcp = entry.startTime;
          }
        });
      });
      observer.observe({ entryTypes: ['paint'] });
      this.observers.push(observer);
    } catch (error) {
      // Failed to observe FCP
    }
  }
  private collectCLS(): void {
    if (!('PerformanceObserver' in window)) return;
    try {
      let clsValue = 0;
      let sessionValue = 0;
      let sessionEntries: any[] = [];
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach(entry => {
          if (!(entry as any).hadRecentInput) {
            const firstSessionEntry = sessionEntries[0];
            const lastSessionEntry = sessionEntries[sessionEntries.length - 1];
            if (sessionValue &&
                entry.startTime - lastSessionEntry.startTime < 1000 &&
                entry.startTime - firstSessionEntry.startTime < 5000) {
              sessionValue += (entry as any).value;
              sessionEntries.push(entry);
            } else {
              sessionValue = (entry as any).value;
              sessionEntries = [entry];
            }
            if (sessionValue > clsValue) {
              clsValue = sessionValue;
              this.webVitals.cls = clsValue;
            }
          }
        });
      });
      observer.observe({ entryTypes: ['layout-shift'] });
      this.observers.push(observer);
    } catch (error) {
      // Failed to observe CLS
    }
  }

  // #4 Per-navigation observers: LCP, FID, INP are reset on each route change
  public resetWebVitalsObservers(): void {
    // Disconnect previous per-navigation observers
    if (this.lcpObserver) { try { this.lcpObserver.disconnect(); } catch {} }
    if (this.fidObserver) { try { this.fidObserver.disconnect(); } catch {} }
    if (this.inpObserver) { try { this.inpObserver.disconnect(); } catch {} }
    this.latestLCP = null;
    this.latestFID = null;
    this.latestINP = null;
    // LCP
    if ('PerformanceObserver' in window) {
      try {
        this.lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            this.latestLCP = lastEntry.startTime;
            this.webVitals.lcp = lastEntry.startTime;
          }
        });
        this.lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      } catch {}
      // FID
      try {
        this.fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach(entry => {
            if (entry.name === 'first-input') {
              const fid = (entry as any).processingStart - entry.startTime;
              this.latestFID = fid;
              this.webVitals.fid = fid;
            }
          });
        });
        this.fidObserver.observe({ entryTypes: ['first-input'] });
      } catch {}
      // INP
      try {
        const interactionMap = new Map<number, number>();
        this.inpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries() as PerformanceEventTiming[];
          entries.forEach(entry => {
            const interactionId = (entry as any).interactionId;
            if (interactionId > 0) {
              const existingDuration = interactionMap.get(interactionId) || 0;
              if (entry.duration > existingDuration) {
                interactionMap.set(interactionId, entry.duration);
              }
              const allDurations = Array.from(interactionMap.values()).sort((a, b) => b - a);
              const interactionCount = allDurations.length;
              if (interactionCount > 0) {
                const p98Index = Math.min(
                  interactionCount - 1,
                  Math.floor(interactionCount / 50)
                );
                this.latestINP = allDurations[p98Index];
                this.webVitals.inp = allDurations[p98Index];
              }
            }
          });
        });
        this.inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 } as any);
      } catch {}
    }
  }

  /** Call when navigation starts so only requests started after this time count toward "page ready". */
  public setNavigationStartTime(timeMs: number): void {
    this.navigationStartTime = timeMs;
  }

  /** Used by HTTP interceptor: register a request start (for page-ready detection). */
  public incrementInFlightRequests(requestId: string, startTimeMs: number): void {
    this.inFlightRequests.set(requestId, startTimeMs);
  }

  /** Used by HTTP interceptor: unregister a request (on response or error). */
  public decrementInFlightRequests(requestId: string): void {
    this.inFlightRequests.delete(requestId);
  }

  /** Count of in-flight requests that started after the last navigation start (this route's APIs only). */
  public getInFlightRequestCount(): number {
    const since = this.navigationStartTime;
    return [...this.inFlightRequests.values()].filter(t => t >= since).length;
  }
}
