// interceptors/monitoring-http.interceptor.ts

import { Injectable, Inject } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpResponse,
  HttpErrorResponse
} from '@angular/common/http';
import { forkJoin, Observable, throwError } from 'rxjs';
import { tap, catchError, finalize } from 'rxjs/operators';
import { MonitoringService } from '../services/monitoring.service';
import { Span } from '../interfaces/monitoring.interfaces';
import { ApmConfig } from '../interfaces/apm-config.interface';
import { APM_CONFIG } from '../tokens/injection-tokens';
import { RouteMonitoringService } from '../services/route-monitoring.service';

@Injectable()
export class MonitoringHttpInterceptor implements HttpInterceptor {
  private activeSpans = new Map<string, Span>();

  constructor(
    private monitoringService: MonitoringService,
    private routeMonitoringService: RouteMonitoringService,
    @Inject(APM_CONFIG) private config: ApmConfig
  ) { }

  intercept(
    request: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    // Skip monitoring for monitoring service requests
    if (this.shouldSkipRequest(request)) {
      return next.handle(request);
    }

    const requestId = this.generateRequestId();
    const startPerf = performance.now();
    this.monitoringService.incrementInFlightRequests(requestId, startPerf);
    const startWallTime = Date.now();
    let span = this.monitoringService.startSpan(
      `${request.method} ${this.getUrlPath(request.url)}`,
      'http',
      'external',
      {
        http: {
          url: request.url,
          method: request.method
        },
        tags: {
          'http.method': request.method,
          'http.url': request.url
        }
      }
    );

    // If span creation fails, create a minimal span object for logging
    if (!span) {
      span = {
        id: requestId,
        transactionId: '',
        name: `${request.method} ${this.getUrlPath(request.url)}`,
        type: 'http',
        subtype: 'external',
        startTime: startPerf,
        context: {
          http: {
            url: request.url,
            method: request.method
          },
          tags: {
            'http.method': request.method,
            'http.url': request.url
          }
        },
        outcome: 'unknown',
        traceId: ''
      };
    } else {
      this.activeSpans.set(requestId, span);
      // Add distributed tracing headers if enabled
      if (this.monitoringService['config']?.distributedTracing) {
        request = this.addTracingHeaders(request, span);
      }
    }

    // Calculate request size
    let apiRequestSize = null;
    if (request.body) {
      try {
        apiRequestSize = JSON.stringify(request.body).length;
      } catch { apiRequestSize = null; }
    }

    return next.handle(request).pipe(
      tap(event => {
        if (event instanceof HttpResponse) {
          const endWallTime = Date.now();
          const endPerf = performance.now();
          const jsDuration = endPerf - startPerf;

          // Parse Server-Timing header: full list of metrics for cross-origin fallback (e.g. "ttfb;dur=130.72, download;dur=0.7")
          let serverProcessing: number | null = null;
          const serverTimingMetrics: Record<string, number> = {};
          const serverTimingHeader = event.headers.get('Server-Timing');
          if (serverTimingHeader) {
            // Split by comma for multiple metrics, then each part: name;dur=123 or name;desc="...";dur=123
            serverTimingHeader.split(',').forEach(part => {
              const durMatch = /dur=([0-9.]+)/.exec(part.trim());
              const nameMatch = /^([a-zA-Z0-9_-]+)/.exec(part.trim());
              const name = nameMatch ? nameMatch[1].toLowerCase() : 'total';
              if (durMatch) {
                const dur = parseFloat(durMatch[1]);
                serverTimingMetrics[name] = dur;
                if (serverProcessing == null) serverProcessing = dur;
              }
            });
          }

          // Find the matching PerformanceResourceTiming entry for HTTP network time (retry once next tick if not found)
          // Fields can be null when cross-origin restricted (browser hides timing details)
          let httpTiming: {
            queueing: number | null;
            dns: number | null;
            connecting: number | null;
            ssl: number | null;
            request: number;
            requestSent: number | null;
            ttfb: number;
            response: number;
            total: number;
            apiTimeInMs: number | null;
          } | null = null;
          let detailedTiming: any = null;
          let resourceTimingDebug: any = null;
          let resourceTimingAvailable = false;
          const tryCaptureResourceTiming = (): void => {
            if (!('performance' in window && 'getEntriesByType' in performance)) return;
            const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            const candidates = entries.filter(e =>
              e.name === request.url &&
              e.startTime >= (startPerf - 100)
            );
            if (candidates.length > 0) {
              resourceTimingAvailable = true;
              const match = candidates.reduce((prev, curr) =>
                Math.abs(curr.responseEnd - endPerf) < Math.abs(prev.responseEnd - endPerf) ? curr : prev
              );
              const total = match.responseEnd - match.startTime;
              // Cross-origin restriction check: when requestStart or responseStart is 0, browser is hiding timing
              // Per spec, when restricted, domainLookupStart/End, connectStart/End are also zeroed
              const isRestricted = match.requestStart === 0 || match.responseStart === 0;
              // DNS/TCP timing: check if these are actually 0 (cached) or cross-origin zeroed
              // If domainLookupStart equals fetchStart and domainLookupEnd equals fetchStart, it could be cached
              // If isRestricted AND these are 0, they're hidden by browser
              const isDnsRestricted = isRestricted && match.domainLookupStart === 0 && match.domainLookupEnd === 0;
              const isTcpRestricted = isRestricted && match.connectStart === 0 && match.connectEnd === 0;
              let ttfb = match.responseStart - match.requestStart;
              let response = match.responseEnd - match.responseStart;

              // APITimeInMS = responseEnd - requestStart (pure HTTP request lifecycle, excludes DNS/TCP/SSL)
              // Only valid when requestStart > 0 (not restricted by cross-origin)
              const apiTimeInMs = !isRestricted && match.requestStart > 0
                ? match.responseEnd - match.requestStart
                : null;

              // Capture all resource timing fields for debugging
              // For cross-origin restricted values, use null instead of misleading 0
              resourceTimingDebug = {
                fetchStart: match.fetchStart,
                domainLookupStart: isDnsRestricted ? null : match.domainLookupStart,
                domainLookupEnd: isDnsRestricted ? null : match.domainLookupEnd,
                connectStart: isTcpRestricted ? null : match.connectStart,
                connectEnd: isTcpRestricted ? null : match.connectEnd,
                secureConnectionStart: isTcpRestricted ? null : (match.secureConnectionStart || null),
                requestStart: isRestricted ? null : match.requestStart,
                responseStart: isRestricted ? null : match.responseStart,
                responseEnd: match.responseEnd,
                startTime: match.startTime,
                duration: match.duration,
                transferSize: match.transferSize,
                encodedBodySize: match.encodedBodySize,
                decodedBodySize: match.decodedBodySize,
                isRestricted: isRestricted,
                isDnsRestricted: isDnsRestricted,
                isTcpRestricted: isTcpRestricted
              };

              // Cross-origin restricted: derive TTFB and response download from Server-Timing only when semantics are correct
              if (isRestricted && total > 0) {
                const stTtfb = serverTimingMetrics['ttfb'] ?? serverTimingMetrics['waiting'] ?? serverTimingMetrics['total'] ?? serverProcessing;
                const stDownload = serverTimingMetrics['download'] ?? serverTimingMetrics['content'];
                const hasExplicitTtfb = serverTimingMetrics['ttfb'] != null || serverTimingMetrics['waiting'] != null;
                if (typeof stTtfb === 'number' && stTtfb >= 0) {
                  ttfb = stTtfb;
                  // Only derive response from (total - ttfb) when ttfb is actual TTFB (ttfb/waiting). Server "total" is not TTFB, so (client total - server total) is not response download.
                  if (typeof stDownload === 'number' && stDownload >= 0) {
                    response = stDownload;
                  } else if (hasExplicitTtfb) {
                    response = Math.max(0, total - stTtfb);
                  }
                  // else keep response = match.responseEnd - match.responseStart (wrong when restricted); sanitization will set to null
                }
              }

              httpTiming = {
                queueing: isRestricted ? null : match.requestStart - match.startTime,
                // DNS: null if cross-origin restricted, otherwise calculate (may be 0 if cached/reused)
                dns: isDnsRestricted ? null : match.domainLookupEnd - match.domainLookupStart,
                // TCP: null if cross-origin restricted, otherwise calculate
                connecting: isTcpRestricted ? null : match.connectEnd - match.connectStart,
                // SSL: null if restricted or no secure connection
                ssl: isTcpRestricted ? null : (match.secureConnectionStart ? match.connectEnd - match.secureConnectionStart : 0),
                request: ttfb,
                requestSent: isRestricted ? null : (match.connectEnd > 0 ? match.requestStart - match.connectEnd : match.requestStart - match.startTime),
                ttfb,
                response,
                total,
                apiTimeInMs
              };
              detailedTiming = {
                browserHttpStack: match.requestStart - match.startTime,
                networkLatency: ttfb,
                serverProcessing: serverProcessing,
                browserParseAndDeliver: response
              };
            }
          };
          tryCaptureResourceTiming();

          const applySpanContext = (): void => {
            span.context.http = {
              ...span.context.http!,
              statusCode: event.status,
              response: {
                headers: this.extractHeaders(event.headers),
                size: this.getResponseSize(event)
              },
              timing: httpTiming,
              detailedTiming
            };
            span.context.tags = {
              ...span.context.tags,
              'http.status_code': event.status.toString(),
              'http.response.size': this.getResponseSize(event).toString()
            };
            span.context.custom = {
              ...span.context.custom,
              performance: {
                jsDuration,
                httpTiming,
                detailedTiming,
                timing: { startWallTime, endWallTime },
                transferSize: this.getResponseSize(event),
                success: true
              }
            };
          };
          applySpanContext();

          // Sanitize breakdown: cross-origin requests often have requestStart/responseStart set to 0, producing negative or huge values
          const sanitize = (val: number | null, check: (n: number) => boolean): number | null => {
            if (val == null) return null;
            return check(val) ? val : null;
          };
          const totalMs = httpTiming ? httpTiming.total : null;
          // Response download cannot exceed total HTTP duration (cross-origin often gives responseEnd-only, inflating response)
          const responseDownloadReasonable = (n: number) => n >= 0 && totalMs != null && n <= totalMs * 1.05;
          const requestSentMsSanitized = httpTiming ? sanitize(httpTiming.requestSent, n => n >= 0 && n < 300000) : null;
          // When TTFB is 0 but total is significant, we don't have real TTFB (e.g. cross-origin restricted); report null instead of misleading 0
          const ttfbMsSanitized = httpTiming
            ? (httpTiming.ttfb === 0 && totalMs != null && totalMs > 10
              ? null
              : sanitize(httpTiming.ttfb, n => n >= 0 && n < 300000))
            : null;
          const responseDownloadMsSanitized = httpTiming ? sanitize(httpTiming.response, responseDownloadReasonable) : null;

          const buildAndSendLog = (): void => {
            // APITimeInMS = responseEnd - requestStart (pure HTTP lifecycle, no DNS/TCP/SSL)
            // Only report when resource timing is available and not cross-origin restricted
            const apiTimeInMsValue = httpTiming?.apiTimeInMs ?? null;

            // Log warning if resource timing is not available (do not use fallback)
            if (!resourceTimingAvailable) {
              console.warn('[APM] Resource timing unavailable for:', request.url);
            }

            const logObj: any = {
              apiUrl: span.context.http?.url,
              apiMethod: span.context.http?.method,
              apiStatusCode: event.status,
              jsDurationMs: jsDuration,
              httpDurationMs: httpTiming ? httpTiming.total : null,
              APITimeInMS: apiTimeInMsValue,
              ApiRequestSize: apiRequestSize,
              resourceTimingAvailable: resourceTimingAvailable,
              ...(this.routeMonitoringService.getCurrentRouteTransaction()?.context?.page ? {
                navigationTo: this.routeMonitoringService.getCurrentRouteTransaction()?.context?.page?.url
              } : {}),
              navigationId: this.routeMonitoringService.getCurrentRouteTransaction()?.id || null,
              dnsMs: httpTiming ? sanitize(httpTiming.dns, n => n >= 0 && n < 30000) : null,
              tcpMs: httpTiming ? sanitize(httpTiming.connecting, n => n >= 0 && n < 30000) : null,
              sslMs: httpTiming ? sanitize(httpTiming.ssl, n => n >= 0 && n < 30000) : null,
              requestSentMs: requestSentMsSanitized,
              ttfbMs: ttfbMsSanitized,
              responseDownloadMs: responseDownloadMsSanitized,
              wallTimingStart: new Date(startWallTime).toISOString(),
              wallTimingEnd: new Date(endWallTime).toISOString(),
              timestamp: new Date().toISOString(),
              // Resource timing debug fields (from Performance API)
              resourceTiming: resourceTimingDebug ? {
                fetchStart: resourceTimingDebug.fetchStart,
                domainLookupStart: resourceTimingDebug.domainLookupStart,
                domainLookupEnd: resourceTimingDebug.domainLookupEnd,
                connectStart: resourceTimingDebug.connectStart,
                connectEnd: resourceTimingDebug.connectEnd,
                requestStart: resourceTimingDebug.requestStart,
                responseStart: resourceTimingDebug.responseStart,
                responseEnd: resourceTimingDebug.responseEnd,
                isRestricted: resourceTimingDebug.isRestricted
              } : null
            };
            this.monitoringService.logPerformanceData('API_CALL', logObj);
            // GR-9408: record breadcrumb for this HTTP call
            try {
              this.monitoringService.addBreadcrumb('http', `${request.method} ${this.getUrlPath(request.url)}`, {
                status: event.status,
                durationMs: Math.round(jsDuration)
              });
            } catch { /* ignore */ }
            if (this.activeSpans.has(requestId)) {
              this.monitoringService.endSpan(span.id, event.status >= 400 ? 'failure' : 'success');
            }
          };

          if (httpTiming) {
            buildAndSendLog();
          } else {
            setTimeout(() => {
              tryCaptureResourceTiming();
              if (httpTiming) applySpanContext();
              buildAndSendLog();
            }, 0);
          }
        }
      }),
      catchError(error => {
        const endWallTime = Date.now();
        const endPerf = performance.now();
        const duration = endPerf - startPerf;

        // Update span context with error information
        span.context.http = {
          ...span.context.http!,
          statusCode: error.status
        };

        span.context.tags = {
          ...span.context.tags,
          'http.status_code': error.status.toString(),
          'error.type': error.name,
          'error.message': error.message
        };

        span.context.custom = {
          ...span.context.custom,
          error: {
            name: error.name,
            message: error.message,
            stack: error.error?.stack
          },
          performance: {
            duration,
            timing: {
              startWallTime,
              endWallTime,
            },
            success: false
          }
        };

        // Calculate request size
        let apiRequestSize = null;
        if (request.body) {
          try {
            apiRequestSize = JSON.stringify(request.body).length;
          } catch { apiRequestSize = null; }
        }

        // Standardized log output
        // Note: Resource timing not available for error responses, log warning
        console.warn('[APM] Resource timing unavailable for error response:', request.url);
        const logObj: any = {
          apiUrl: span.context.http?.url,
          apiMethod: span.context.http?.method,
          apiStatusCode: error.status,
          jsDurationMs: duration,
          httpDurationMs: null,
          APITimeInMS: null,
          ApiRequestSize: apiRequestSize,
          resourceTimingAvailable: false,
          // Navigation context if available
          ...(this.routeMonitoringService.getCurrentRouteTransaction()?.context?.page ? {
            navigationTo: this.routeMonitoringService.getCurrentRouteTransaction()?.context?.page?.url
          } : {}),
          navigationId: this.routeMonitoringService.getCurrentRouteTransaction()?.id || null,
          wallTimingStart: new Date(startWallTime).toISOString(),
          wallTimingEnd: new Date(endWallTime).toISOString(),
          error: error.message,
          errorType: error.name,
          timestamp: new Date().toISOString(),
          resourceTiming: null,
          // Error context fields
          ErrorMessage: error.message,
          ErrorStack: error.stack || null,
          ErrorType: error.name,
          ErrorUrl: span.context.http?.url
        };
        this.monitoringService.logPerformanceData('API_CALL', logObj);
        // GR-9408: record breadcrumb for failed HTTP call
        try {
          this.monitoringService.addBreadcrumb('http', `${request.method} ${this.getUrlPath(request.url)} FAILED`, {
            status: error.status,
            errorType: error.name,
            durationMs: Math.round(duration)
          });
        } catch { /* ignore */ }
        // End span if it was created by monitoringService
        if (this.activeSpans.has(requestId)) {
          this.monitoringService.endSpan(span.id, 'failure');
          // Also capture the error in the monitoring service
          this.monitoringService.captureError(
            new Error(`HTTP ${error.status}: ${error.message}`),
            {
              url: span.context.http?.url,
              method: span.context.http?.method,
              statusCode: error.status,
              duration
            }
          );
        }
        return throwError(error);
      }),
      finalize(() => {
        this.monitoringService.decrementInFlightRequests(requestId);
        this.cleanupSpan(requestId);
      })
    );
  }

  private shouldSkipRequest(request: HttpRequest<any>): boolean {
    // Skip requests to monitoring endpoints - use configurable patterns
    const monitoringUrls = this.config.skipUrlPatterns ?? ['/apm', '/monitoring', '/telemetry', '/InsertAPMLog'];
    const urlLower = request.url.toLowerCase();
    if (monitoringUrls.some(url => urlLower.includes(url.toLowerCase()))) {
      return true;
    }
    return false;
  }

  private addTracingHeaders(request: HttpRequest<any>, span: Span): HttpRequest<any> {
    const currentTransaction = this.monitoringService.getCurrentTransaction();
    if (!currentTransaction) return request;

    // Add distributed tracing headers (similar to Elastic APM format)
    const headers: { [key: string]: string } = {};

    // Elastic APM compatible headers
    headers['elastic-apm-traceparent'] = this.generateTraceParent(
      currentTransaction.traceId,
      span.id
    );

    // OpenTracing compatible headers
    headers['x-trace-id'] = currentTransaction.traceId;
    headers['x-span-id'] = span.id;

    return request.clone({
      setHeaders: headers
    });
  }

  private generateTraceParent(traceId: string, spanId: string): string {
    // W3C Trace Context format: version-traceid-parentid-flags
    const version = '00';
    const flags = '01'; // sampled
    return `${version}-${traceId}-${spanId}-${flags}`;
  }

  private extractHeaders(headers: any): Record<string, string> {
    const result: Record<string, string> = {};

    if (headers && headers.keys) {
      headers.keys().forEach((key: string) => {
        result[key.toLowerCase()] = headers.get(key);
      });
    }

    return result;
  }

  private getResponseSize(response: HttpResponse<any>): number {
    // Try to get content-length header first
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      return parseInt(contentLength, 10);
    }

    // Fallback to estimating size from response body
    if (response.body) {
      try {
        return JSON.stringify(response.body).length;
      } catch {
        return 0;
      }
    }

    return 0;
  }

  private getUrlPath(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch {
      // If URL parsing fails, return the original URL
      return url;
    }
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private cleanupSpan(requestId: string): void {
    this.activeSpans.delete(requestId);
  }
}
