/**
 * Device detection adapter.
 * Returns true if the app is running on a mobile device (Capacitor native shell).
 * Used to decide whether to call Capacitor plugins and to set Source/DeviceType fields.
 */
export interface ApmDeviceDetector {
  isMobile(): boolean;

  /**
   * Optional: Provides battery info (mobile only).
   * Implementations typically use the Capacitor Device plugin's getBatteryInfo().
   * Returns null if not available (web / unsupported).
   */
  getBatteryInfo?(): Promise<ApmBatteryInfo | null>;

  /**
   * Optional: Provides storage info (mobile only).
   * Returns null if not available.
   */
  getStorageInfo?(): Promise<ApmStorageInfo | null>;
}

export interface ApmBatteryInfo {
  /** Battery level 0-100 */
  level: number;
  /** Whether device is charging */
  isCharging: boolean;
}

export interface ApmStorageInfo {
  /** Free disk space in MB */
  freeMB: number;
  /** Total disk space in MB */
  totalMB: number;
}
