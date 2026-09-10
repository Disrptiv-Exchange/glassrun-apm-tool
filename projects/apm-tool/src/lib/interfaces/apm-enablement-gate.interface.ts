/**
 * Decides whether APM may collect at all.
 *
 * Exists because the answer usually is not known when the app boots. Where the switch lives in
 * data the app only receives after login, registering PerformanceObservers, patching console
 * and building a log object per event from startup onwards would pay the entire collection
 * cost even when APM is turned off - only the network call would be avoided.
 *
 * Supplying a gate makes MonitoringService.init() register nothing. It polls this instead, and
 * calls start() the first time it answers true. If the answer later becomes false it calls
 * stop(), which disconnects the observers and restores everything that was patched.
 *
 * Apps without a gate keep the previous behaviour: init() starts collection immediately.
 */
export interface ApmEnablementGate {
  /**
   * `true`  - collect and send.
   * `false` - do not collect; tear down if already running.
   * `null`  - not known yet (for example the setting has not arrived). Keep waiting; nothing
   *           is registered and nothing is torn down while the answer is null.
   */
  isEnabled(): boolean | null;
}
