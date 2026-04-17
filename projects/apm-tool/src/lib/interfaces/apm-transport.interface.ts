/**
 * Transport adapter for sending APM log data to the backend.
 * Consuming apps must implement this interface to handle URL construction,
 * encryption, HTTP POST, etc.
 * Implementation must be fire-and-forget (should not throw or block the app).
 */
export interface ApmTransport {
  send(logType: string, data: Record<string, unknown>): void;
  sendBatch(logs: Record<string, unknown>[]): void;
}
