import { Injectable, ErrorHandler } from '@angular/core';
import { MonitoringService } from '../services/monitoring.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  constructor(private monitoringService: MonitoringService) {}

  handleError(error: Error) {
    // Get the component where the error occurred
    let componentInfo;
    try {
      const errorStack = error.stack || '';
      const componentMatch = errorStack.match(/at\s+([\w\d]+Component)\./);
      componentInfo = componentMatch ? componentMatch[1] : 'unknown';
    } catch {
      componentInfo = 'unknown';
    }

    // Capture error with component context
    this.monitoringService.captureError(error, {
      component: componentInfo,
      state: this.getComponentState()
    });

    // #6 Log to console instead of re-throwing to prevent double-reporting
    // Re-throwing causes Angular's default handler to also fire, and can cause
    // silent bootstrap failures (blank screen) when errors occur during initialization
    console.error('Angular Error:', error);
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
