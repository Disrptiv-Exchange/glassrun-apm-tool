/**
 * Dynamic import wrapper that prevents webpack from trying to resolve the module at build time.
 * Uses indirect Function constructor so webpack cannot statically analyze the import path.
 */
function dynamicImport(modulePath: string): Promise<any> {
  return new Function('modulePath', 'return import(modulePath)')(modulePath);
}

/**
 * Attempt to get Capacitor App info (version, build).
 * Returns null if the plugin is not available.
 */
export async function tryGetCapacitorAppInfo(): Promise<{ version: string; build: string } | null> {
  try {
    const module = await dynamicImport('@capacitor/app');
    const App = module.App;
    const info = await App.getInfo();
    return { version: info.version || '', build: info.build || '' };
  } catch {
    return null;
  }
}

/**
 * Attempt to get Capacitor Device info.
 * Returns null if the plugin is not available.
 */
export async function tryGetCapacitorDeviceInfo(): Promise<{
  platform: string;
  manufacturer: string;
  model: string;
  osVersion: string;
  identifier: string;
  serial: string;
} | null> {
  try {
    const module = await dynamicImport('@capacitor/device');
    const Device = module.Device;
    const info = await Device.getInfo();
    const id = await Device.getId();
    return {
      platform: info.platform || 'android',
      manufacturer: info.manufacturer || '',
      model: info.model || '',
      osVersion: info.osVersion || '',
      identifier: id.identifier || '',
      serial: (info as any).serial || ''
    };
  } catch {
    return null;
  }
}
