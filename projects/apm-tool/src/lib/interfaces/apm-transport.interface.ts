/**
 * Transport adapter for sending APM log data to the backend.
 * Consuming apps must implement this interface to handle URL construction,
 * encryption, HTTP POST, etc.
 * Implementation must be fire-and-forget (should not throw or block the app).
 */
export interface ApmTransport {
  /**
   * Returning `false` means the batch was NOT sent and should be retried - the caller puts
   * it back on the buffer. Returning nothing keeps the original contract (assumed sent), so
   * existing implementations need no change.
   *
   * Use it for a transport that can be temporarily unable to send, such as one whose API URL
   * is not resolvable until the user has logged in. Without it those logs are lost, because
   * the buffer is drained before the transport is called.
   */
  send(logType: string, data: Record<string, unknown>): void | boolean;
  sendBatch(logs: Record<string, unknown>[]): void | boolean;
}
