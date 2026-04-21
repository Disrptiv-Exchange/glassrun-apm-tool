// services/route-monitoring.service.ts

import { ApplicationRef, Injectable } from '@angular/core';
import { Router, NavigationEnd, NavigationStart, NavigationError } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { MonitoringService } from './monitoring.service';
import { Transaction } from '../interfaces/monitoring.interfaces';

/** Only clear watchers after this (no log on timeout); never send data on assumption/timeout. */
const PAGE_READY_CLEANUP_MS = 120000;
/** How long in-flight (this route's APIs) must be 0 before we consider "data loaded" (ms). */
const IDLE_AFTER_LAST_REQUEST_MS = 400;
/** Poll interval for in-flight check (ms). */
const IN_FLIGHT_POLL_MS = 200;

@Injectable()
export class RouteMonitoringService {
  private currentRouteTransaction: Transaction | null = null;
  private navigationStartTime: number = 0;
  private isInitialized = false;

  constructor(
    private router: Router,
    private applicationRef: ApplicationRef,
    private monitoringService: MonitoringService
  ) {
  }

  /**
   * Initialize route monitoring
   */
  init(): void {
    if (this.isInitialized) return;

    this.setupRouterEventListeners();
    this.isInitialized = true;
  }

  private setupRouterEventListeners(): void {
    // Listen for navigation start events
    this.router.events.pipe(
      filter(event => event instanceof NavigationStart)
    ).subscribe((event: NavigationStart) => {
      this.handleNavigationStart(event);
    });

    // Listen for successful navigation end events
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      // Store the previous URL before handling the new navigation
      const previousUrl = this.currentRouteTransaction?.context?.page?.url || null;
      this.handleNavigationEnd(event, previousUrl);
    });

    // Listen for navigation errors
    this.router.events.pipe(
      filter(event => event instanceof NavigationError)
    ).subscribe((event: NavigationError) => {
      this.handleNavigationError(event);
    });

    // Also listen to browser history changes (back/forward buttons)
    window.addEventListener('popstate', (event) => {
      this.handlePopState(event);
    });
  }

  private handleNavigationStart(event: NavigationStart): void {
    this.navigationStartTime = performance.now();
    this.monitoringService.setNavigationStartTime(this.navigationStartTime);

    // End current route transaction if exists
    if (this.currentRouteTransaction) {
      this.monitoringService.endTransaction('success');
      this.currentRouteTransaction = null;
    }

    // Start new route transaction
    this.currentRouteTransaction = this.monitoringService.startTransaction(
      `Route: ${event.url}`,
      'route-change',
      {
        page: {
          url: window.location.origin + event.url,
          referer: window.location.href
        },
        tags: {
          'navigation.type': 'route-change',
          'route.url': event.url,
          'route.id': event.id.toString(),
          'navigation.trigger': event.navigationTrigger || 'imperative'
        },
        custom: {
          navigation: {
            id: event.id,
            url: event.url,
            trigger: event.navigationTrigger,
            restoredState: event.restoredState,
            startTime: this.navigationStartTime
          }
        }
      }
    );

    // GR-9408: record navigation breadcrumb
    try {
      this.monitoringService.addBreadcrumb('navigation', `Navigate to ${event.url}`, {
        trigger: event.navigationTrigger,
        id: event.id
      });
    } catch { /* ignore */ }
  }

  private handleNavigationEnd(current: NavigationEnd, previousUrl?: string | null): void {
    if (!this.currentRouteTransaction) {
      // If no transaction exists (e.g., first navigation), create one
      this.navigationStartTime = performance.now() - 100; // Approximate start time
      this.monitoringService.setNavigationStartTime(this.navigationStartTime);
      this.currentRouteTransaction = this.monitoringService.startTransaction(
        `Route: ${current.url}`,
        'route-change',
        {
          page: {
            url: window.location.origin + current.url,
            referer: previousUrl || document.referrer
          },
          tags: {
            'navigation.type': 'route-change',
            'route.url': current.url,
            'route.id': current.id.toString()
          }
        }
      );
    }

    const navigationDuration = performance.now() - this.navigationStartTime;
    const startTime = this.navigationStartTime;
    const routeResolutionMs = navigationDuration;

    // Add navigation timing information
    this.monitoringService.addTransactionContext({
      custom: {
        ...this.currentRouteTransaction.context.custom,
        ['navigation']: {
          ...this.currentRouteTransaction.context.custom?.['navigation'],
          duration: navigationDuration,
          endUrl: current.url,
          previousUrl: previousUrl,
          endTime: performance.now()
        },
        timing: {
          navigationDuration,
          routeResolution: navigationDuration
        }
      }
    });


    // Update transaction name with final URL
    this.currentRouteTransaction.name = `Route: ${current.url}`;

    // End the transaction (route resolution complete)
    this.monitoringService.endTransaction('success');
    this.currentRouteTransaction = null;

    // Capture route change metrics
    this.captureRouteChangeMetrics(current, previousUrl, navigationDuration);

    // Log TotalPageLoadTimeMs when app is stable (data loaded + UI available), single common place
    this.schedulePageNavigationLog(startTime, current, previousUrl, routeResolutionMs);
  }

  /**
   * Log page load only when we have a real signal: (1) zone stable, or (2) this route's HTTP
   * requests are all done and idle for IDLE_AFTER_LAST_REQUEST_MS. Never log on timeout/fallback.
   */
  private schedulePageNavigationLog(
    startTime: number,
    current: NavigationEnd,
    previousUrl: string | null | undefined,
    routeResolutionMs: number
  ): void {
    this.monitoringService.resetWebVitalsObservers();

    let completed = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cleanupId: ReturnType<typeof setTimeout> | null = null;
    let idleSince: number | null = null;
    let stableSub: Subscription | null = null;

    const clearWatchers = (): void => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (cleanupId != null) {
        clearTimeout(cleanupId);
        cleanupId = null;
      }
      if (stableSub != null) {
        stableSub.unsubscribe();
        stableSub = null;
      }
    };

    const tryComplete = (reason: 'stable' | 'idle'): void => {
      if (completed) return;
      completed = true;
      clearWatchers();
      this.logPageNavigationReady(startTime, current, previousUrl, routeResolutionMs, reason);
    };

    // Path 1: zone became stable (real signal)
    stableSub = this.applicationRef.isStable.pipe(
      filter((stable: boolean) => stable === true),
      take(1)
    ).subscribe(() => tryComplete('stable'));

    // Path 2: this route's in-flight requests are 0 for IDLE_AFTER_LAST_REQUEST_MS (real signal)
    intervalId = setInterval(() => {
      if (completed) return;
      const inFlight = this.monitoringService.getInFlightRequestCount();
      if (inFlight === 0) {
        const now = performance.now();
        if (idleSince == null) idleSince = now;
        else if (now - idleSince >= IDLE_AFTER_LAST_REQUEST_MS) tryComplete('idle');
      } else {
        idleSince = null;
      }
    }, IN_FLIGHT_POLL_MS);

    // Cleanup only: clear watchers after PAGE_READY_CLEANUP_MS; do not log
    cleanupId = setTimeout(() => {
      if (completed) return;
      completed = true;
      clearWatchers();
    }, PAGE_READY_CLEANUP_MS);
  }

  /**
   * Log PageNavigation with TotalPageLoadTimeMs = time from navigation start until ready.
   * Only called when we have a real signal (stable or idle); never on timeout.
   */
  private logPageNavigationReady(
    startTime: number,
    current: NavigationEnd,
    previousUrl: string | null | undefined,
    routeResolutionMs: number,
    reason: 'stable' | 'idle'
  ): void {
    const totalPageLoadTimeMs = performance.now() - startTime;
    const perfMetrics = this.monitoringService['collectPerformanceMetrics']();
    const isInitialLoad = previousUrl === null || previousUrl === undefined || previousUrl === 'initial';

    // For SPA route changes, these fields from initial page load are NOT applicable:
    // NavigationStart, UnloadEventStart, UnloadEventEnd, RedirectStart, RedirectEnd
    // They only apply to the initial HTML document load, not Angular router navigations.
    const logData: any = {
      from: previousUrl || 'initial',
      to: current.url,
      navigationDuration: routeResolutionMs,
      navigationId: current.id,
      navigationTrigger: (current as any).navigationTrigger || 'imperative',
      pageLoadTime: totalPageLoadTimeMs,
      TotalPageLoadTimeMs: totalPageLoadTimeMs,
      pageStable: reason === 'stable',
      pageReadyReason: reason as string,
      isSpaRouteChange: !isInitialLoad,
      // Paint timing (FCP, LCP) - applicable to SPA route changes
      ...(perfMetrics?.paintTiming || {}),
      // Web Vitals (INP, etc.) - applicable to SPA route changes
      ...(perfMetrics?.vitals || {}),
      timestamp: new Date().toISOString()
    };

    // Only include browser navigation timing for initial page load
    // For SPA route changes, these values are stale (from initial HTML load) and misleading
    if (isInitialLoad && perfMetrics?.navigationTiming) {
      logData.NavigationStart = perfMetrics.navigationTiming.navigationStart ?? null;
      logData.UnloadEventStart = perfMetrics.navigationTiming.unloadEventStart ?? null;
      logData.UnloadEventEnd = perfMetrics.navigationTiming.unloadEventEnd ?? null;
      logData.RedirectStart = perfMetrics.navigationTiming.redirectStart ?? null;
      logData.RedirectEnd = perfMetrics.navigationTiming.redirectEnd ?? null;
      logData.FetchStart = perfMetrics.navigationTiming.fetchStart ?? null;
      logData.DomainLookupStart = perfMetrics.navigationTiming.domainLookupStart ?? null;
      logData.DomainLookupEnd = perfMetrics.navigationTiming.domainLookupEnd ?? null;
      logData.ConnectStart = perfMetrics.navigationTiming.connectStart ?? null;
      logData.ConnectEnd = perfMetrics.navigationTiming.connectEnd ?? null;
      logData.RequestStart = perfMetrics.navigationTiming.requestStart ?? null;
      logData.ResponseStart = perfMetrics.navigationTiming.responseStart ?? null;
      logData.ResponseEnd = perfMetrics.navigationTiming.responseEnd ?? null;
      logData.navigationType = perfMetrics.navigationTiming.navigationType ?? null;
    }

    this.monitoringService.logPerformanceData('PageNavigation', logData);
  }

  private handleNavigationError(event: NavigationError): void {
    if (!this.currentRouteTransaction) return;

    const navigationDuration = performance.now() - this.navigationStartTime;

    // Add error information to transaction
    this.monitoringService.addTransactionContext({
      custom: {
        ...this.currentRouteTransaction.context.custom,
        error: {
          message: event.error?.message || 'Navigation failed',
          stack: event.error?.stack,
          url: event.url
        },
        ['navigation']: {
          ...this.currentRouteTransaction.context.custom?.['navigation'],
          duration: navigationDuration,
          error: true
        }
      }
    });

    // End transaction with failure
    this.monitoringService.endTransaction('failure');

    // Capture the navigation error
    this.monitoringService.captureError(
      new Error(`Navigation failed: ${event.error?.message || 'Unknown error'}`),
      {
        url: event.url,
        navigationId: event.id,
        type: 'navigation-error'
      }
    );

    // Log navigation error with error context fields
    const logObj = {
      navigationTo: event.url,
      navigationId: event.id,
      navigationDuration: navigationDuration,
      ErrorMessage: event.error?.message || 'Navigation failed',
      ErrorStack: event.error?.stack || null,
      ErrorType: event.error?.name || 'NavigationError',
      ErrorUrl: event.url,
      timestamp: new Date().toISOString()
    };


    this.monitoringService.logPerformanceData('NavigationError', logObj);

    this.currentRouteTransaction = null;
  }

  private handlePopState(event: PopStateEvent): void {
    // Handle browser back/forward navigation
    const currentUrl = window.location.pathname + window.location.search;

    this.navigationStartTime = performance.now();

    this.currentRouteTransaction = this.monitoringService.startTransaction(
      `Route: ${currentUrl}`,
      'route-change',
      {
        page: {
          url: window.location.href,
          referer: document.referrer
        },
        tags: {
          'navigation.type': 'popstate',
          'route.url': currentUrl
        },
        custom: {
          navigation: {
            type: 'popstate',
            url: currentUrl,
            state: event.state
          }
        }
      }
    );

    // For popstate, we'll end the transaction after a short delay
    // since we don't have router events to rely on
    setTimeout(() => {
      if (this.currentRouteTransaction) {
        const duration = performance.now() - this.navigationStartTime;

        this.monitoringService.addTransactionContext({
          custom: {
            ...this.currentRouteTransaction.context.custom,
            ['navigation']: {
              ...this.currentRouteTransaction.context.custom?.['navigation'],
              duration
            }
          }
        });

        this.monitoringService.endTransaction('success');
        this.currentRouteTransaction = null;
      }
    }, 100);
  }

  private captureRouteChangeMetrics(
    current: NavigationEnd,
    previousUrl: string | null | undefined,
    duration: number
  ): void {
    // Create a span for route resolution if it took significant time
    if (duration > 10) { // Only if route change took more than 10ms
      const span = this.monitoringService.startSpan(
        `Route Resolution: ${current.url}`,
        'custom',
        'route-resolution',
        {
          tags: {
            'route.from': previousUrl || 'initial',
            'route.to': current.url
          },
          custom: {
            duration,
            routeId: current.id
          }
        }
      );

      if (span) {
        span.startTime = this.navigationStartTime;
        span.endTime = this.navigationStartTime + duration;
        span.duration = duration;
        span.outcome = 'success';
        this.monitoringService.endSpan(span.id, 'success');
      }
    }

    // Capture performance metrics for route changes
    this.captureRoutePerformanceMetrics(current.url, duration);
  }

  private captureRoutePerformanceMetrics(url: string, duration: number): void {
    // Use Performance API to capture additional metrics
    if ('performance' in window && 'getEntriesByType' in performance) {
      try {
        // Capture any new resource timings since navigation started
        const resourceEntries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const recentResources = resourceEntries.filter(
          entry => entry.startTime >= this.navigationStartTime
        );

        if (recentResources.length > 0) {
          const span = this.monitoringService.startSpan(
            `Route Resources: ${url}`,
            'custom',
            'route-resources',
            {
              custom: {
                resourceCount: recentResources.length,
                totalSize: recentResources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
                resources: recentResources.map(entry => ({
                  name: entry.name,
                  duration: entry.duration,
                  size: entry.transferSize,
                  type: entry.initiatorType
                }))
              }
            }
          );

          if (span) {
            span.startTime = this.navigationStartTime;
            span.endTime = this.navigationStartTime + duration;
            span.duration = duration;
            span.outcome = 'success';
            this.monitoringService.endSpan(span.id, 'success');
          }
        }
      } catch (error) {
        console.warn('Failed to capture route performance metrics:', error);
      }
    }
  }

  /**
   * Manually start a route transaction (useful for programmatic navigation)
   */
  startRouteTransaction(routeName: string, url: string): Transaction {
    return this.monitoringService.startTransaction(
      `Route: ${routeName}`,
      'route-change',
      {
        page: {
          url: window.location.origin + url
        },
        tags: {
          'navigation.type': 'manual',
          'route.url': url,
          'route.name': routeName
        }
      }
    );
  }

  /**
   * Get the current route transaction
   */
  getCurrentRouteTransaction(): Transaction | null {
    return this.currentRouteTransaction;
  }
}
