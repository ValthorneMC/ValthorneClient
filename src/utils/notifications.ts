import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

let permissionChecked = false;
let permissionGranted = false;

async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionChecked) {
    return permissionGranted;
  }

  try {
    permissionGranted = await isPermissionGranted();
    
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }
    
    permissionChecked = true;
    return permissionGranted;
  } catch {
    permissionChecked = true;
    permissionGranted = true;
    return true;
  }
}

export async function sendNotificationSafe(options: { title: string; body: string }): Promise<void> {
  try {
    const hasPermission = await ensureNotificationPermission();
    if (hasPermission) {
      await sendNotification(options);
    }
  } catch {}
}

export async function initializeNotificationPermissions(): Promise<void> {
  await ensureNotificationPermission();
}

