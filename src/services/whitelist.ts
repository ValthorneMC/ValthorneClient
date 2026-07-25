import { invoke } from '@tauri-apps/api/core';
import type { AccessCheck } from '@/types/whitelist';
import { logger } from '@/utils/logger';

export class WhitelistService {
  static async checkAccess(username: string): Promise<AccessCheck> {
    try {
      const result = await invoke<AccessCheck>('check_whitelist_access', { username });
      return result;
    } catch (error) {
      void logger.error('Error checking whitelist access', error, 'WhitelistService');
      return {
        has_access: false,
        allowed_instances: [],
        global_access: false
      };
    }
  }

  static async clearCache(): Promise<void> {
    try {
      await invoke('clear_whitelist_cache');
    } catch (error) {
      void logger.error('Error clearing whitelist cache', error, 'WhitelistService');
    }
  }

  static async hasInstanceAccess(username: string, instanceId: string): Promise<boolean> {
    const accessCheck = await this.checkAccess(username);
    
    if (!accessCheck.has_access) {
      return false;
    }

    if (accessCheck.global_access) {
      return true;
    }

    return accessCheck.allowed_instances.includes(instanceId);
  }
}
