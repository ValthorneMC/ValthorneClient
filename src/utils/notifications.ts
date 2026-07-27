import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { logger } from '@/utils/logger';

let permissionGranted = false;
let pendingRequest: Promise<boolean> | null = null;

async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionGranted) {
    return true;
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = (async () => {
    try {
      permissionGranted = await isPermissionGranted();

      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }

      return permissionGranted;
    } catch (error) {
      void logger.warn(`Could not check notification permission: ${error}`, 'notifications');
      return false;
    } finally {
      pendingRequest = null;
    }
  })();

  return pendingRequest;
}

export async function sendNotificationSafe(options: { title: string; body: string }): Promise<void> {
  try {
    const hasPermission = await ensureNotificationPermission();
    if (!hasPermission) {
      void logger.debug(`Ommited notification: ${options.title}`, 'notifications');
      return;
    }

    await sendNotification(options);
  } catch (error) {
    void logger.warn(`Could not send notification "${options.title}": ${error}`, 'notifications');
  }
}

export async function initializeNotificationPermissions(): Promise<void> {
  await ensureNotificationPermission();
}
