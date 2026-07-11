import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';

let adminCache: Map<string, boolean> = new Map();

export class AdminService {
  static async checkIsAdmin(username: string): Promise<boolean> {
    try {
      if (adminCache.has(username)) {
        return adminCache.get(username)!;
      }

      const isAdmin = await invoke<boolean>('check_is_admin', { username });
      adminCache.set(username, isAdmin);
      
      return isAdmin;
    } catch (error) {
      void logger.error('Error checking admin status', error, 'AdminService');
      return false;
    }
  }

  static clearCache(): void {
    adminCache.clear();
  }

  static clearUserCache(username: string): void {
    adminCache.delete(username);
  }
}

