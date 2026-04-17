// interfaces/monitoring.interfaces.ts

export interface MonitoringConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  serverUrl: string;
  active: boolean;
  sampleRate: number;
  transactionSampleRate: number;
  capturePageLoad: boolean;
  captureInteractions: boolean;
  captureErrors: boolean;
  distributedTracing: boolean;
  apiRequestTimeout: number;
  maxTransactionDuration: number;
  maxSpans: number;
  flushInterval: number;
  bufferSize: number;
}

export interface Transaction {
  id: string;
  name: string;
  type: 'page-load' | 'route-change' | 'custom';
  startTime: number;
  endTime?: number;
  duration?: number;
  spans: Span[];
  context: TransactionContext;
  outcome: 'success' | 'failure' | 'unknown';
  sampled: boolean;
  traceId: string;
}

export interface Span {
  id: string;
  transactionId: string;
  parentId?: string;
  name: string;
  type: 'http' | 'db' | 'external' | 'custom';
  subtype?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  context: SpanContext;
  outcome: 'success' | 'failure' | 'unknown';
  traceId: string;
}

export interface TransactionContext {
  page?: {
    url: string;
    referer?: string;
  };
  user?: {
    id?: string;
    username?: string;
    email?: string;
  };
  tags?: Record<string, string>;
  custom?: Record<string, any>;
}

export interface SpanContext {
  http?: HttpContext;
  tags?: Record<string, string>;
  custom?: Record<string, any>;
}

export interface HttpContext {
  url: string;
  method: string;
  statusCode?: number;
  response?: {
    headers?: Record<string, string>;
    size?: number;
  };
  timing?: {
    queueing: number;
    dns: number;
    connecting: number;
    ssl: number;
    request: number;
    response: number;
    total: number;
  };
  detailedTiming?: {
    browserHttpStack: number;
    networkLatency: number;
    serverProcessing: number | null;
    browserParseAndDeliver: number;
  };
}

export interface NavigationTimingMetrics {
  navigationStart: number;
  unloadEventStart: number;
  unloadEventEnd: number;
  redirectStart: number;
  redirectEnd: number;
  fetchStart: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  connectEnd: number;
  secureConnectionStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  domLoading: number;
  domInteractive: number;
  domContentLoadedEventStart: number;
  domContentLoadedEventEnd: number;
  domComplete: number;
  loadEventStart: number;
  loadEventEnd: number;
}

export interface PaintTimingMetrics {
  firstPaint?: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
}

export interface ResourceTimingMetrics {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  initiatorType: string;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}

export interface WebVitalsMetrics {
  fcp?: number; // First Contentful Paint
  lcp?: number; // Largest Contentful Paint
  fid?: number; // First Input Delay
  cls?: number; // Cumulative Layout Shift
  inp?: number; // Interaction to Next Paint
  ttfb?: number; // Time to First Byte
}

export interface PerformanceMetrics {
  navigationTiming: NavigationTimingMetrics;
  paintTiming: PaintTimingMetrics;
  resourceTiming: ResourceTimingMetrics[];
  vitals: WebVitalsMetrics;
}
