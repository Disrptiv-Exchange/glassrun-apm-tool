import { Injectable, ErrorHandler, Injector } from '@angular/core';
import { MonitoringService } from '../services/monitoring.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  // Inject the Injector, NOT MonitoringService. Registered as the app's
  // ErrorHandler this class is constructed very early in bootstrap; eagerly
  // injecting MonitoringService there hits a dead injection context (NG0203)
  // and blanks the app. Resolving it lazily in handleError avoids that.
  constructor(private injector: Injector) {}

  handleError(error: Error) {
    // APM capture must never interfere with the app's own error handling.
    try {
      let componentInfo: string;
      try {
        const errorStack = error.stack || '';
        const componentMatch = errorStack.match(/at\s+([\w\d]+Component)\./);
        componentInfo = componentMatch ? componentMatch[1] : 'unknown';
      } catch {
        componentInfo = 'unknown';
      }

      this.injector.get(MonitoringService).captureError(error, {
        component: componentInfo,
        state: this.getComponentState()
      });
    } catch {
      /* swallow any capture failure */
    }

    // Re-throw so Angular's default error reporting continues normally.
    // Not re-throwing causes Angular's bootstrap/change-detection to behave
    // inconsistently, resulting in silent blank screens.
    throw error;
  }

  private getComponentState(): any {
    try {
      // Get current route state
      const routeState = window.history.state;
      // Get form states if available
      const forms = document.querySelectorAll('form');
      const formStates = Array.from(forms).map(form => ({
        id: form.id,
        valid: form.checkValidity(),
        elements: form.elements.length
      }));

      return {
        route: routeState,
        forms: formStates,
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
    } catch {
      return null;
    }
  }
}
