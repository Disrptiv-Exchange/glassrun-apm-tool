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

    // Re-throw so Angular's Zone-aware error reporting continues normally.
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
