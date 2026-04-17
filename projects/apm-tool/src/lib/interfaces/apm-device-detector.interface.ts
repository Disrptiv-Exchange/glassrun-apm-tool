/**
 * Device detection adapter.
 * Returns true if the app is running on a mobile device (Capacitor native shell).
 * Used to decide whether to call Capacitor plugins and to set Source/DeviceType fields.
 */
export interface ApmDeviceDetector {
  isMobile(): boolean;
}
