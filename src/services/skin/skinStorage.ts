import { SkinData } from '@/types/skin';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';

const SKINS_METADATA_KEY = 'kkk_user_skins_metadata';
const ACTIVE_SKIN_KEY = 'kkk_active_skin';

export class SkinStorageService {
  static async saveSkin(skinData: SkinData): Promise<void> {
    try {
      if (skinData.fileData && skinData.fileData instanceof ArrayBuffer && skinData.fileData.byteLength > 0) {
        const uint8Array = new Uint8Array(skinData.fileData);
        await invoke('save_skin_file', {
          skinId: skinData.id,
          fileData: Array.from(uint8Array)
        });
      }

      const existingMetadata = await this.getSkinsMetadata();
      const metadata = {
        id: skinData.id,
        name: skinData.name,
        url: skinData.url || '',
        textureId: skinData.textureId || '',
        variant: skinData.variant,
        uploadedAt: skinData.uploadedAt.toISOString(),
        isActive: skinData.isActive || false,
        isMojangSynced: skinData.isMojangSynced || false
      };

      const updatedMetadata = existingMetadata.filter(m => m.id !== skinData.id);
      updatedMetadata.push(metadata);

      localStorage.setItem(SKINS_METADATA_KEY, JSON.stringify(updatedMetadata));
    } catch (error) {
      void logger.error('Error saving skin', error, 'SkinStorageService');
      throw new Error('Error al guardar skin');
    }
  }

  static async getStoredSkins(): Promise<SkinData[]> {
    try {
      const metadata = await this.getSkinsMetadata();
      const skinFiles = await invoke<string[]>('list_skin_files');

      return await Promise.all(metadata.map(async (meta) => {
        let fileData: ArrayBuffer | undefined = undefined;

        if (skinFiles.includes(meta.id)) {
          try {
            const fileDataArray = await invoke<number[]>('load_skin_file', { skinId: meta.id });
            const uint8Array = new Uint8Array(fileDataArray);
            const buffer = new ArrayBuffer(uint8Array.length);
            const view = new Uint8Array(buffer);
            view.set(uint8Array);
            fileData = buffer;
          } catch (err) {
            void logger.error(`Error loading fileData for skin ${meta.id}`, err, 'SkinStorageService');
          }
        }

        return {
          id: meta.id,
          name: meta.name || '',
          url: meta.url || '',
          textureId: meta.textureId || '',
          variant: meta.variant || 'classic',
          uploadedAt: new Date(meta.uploadedAt),
          isActive: meta.isActive || false,
          isMojangSynced: meta.isMojangSynced || false,
          fileData
        };
      }));
    } catch (error) {
      void logger.error('Error loading skins', error, 'SkinStorageService');
      return [];
    }
  }

  private static async getSkinsMetadata(): Promise<any[]> {
    try {
      const stored = localStorage.getItem(SKINS_METADATA_KEY);
      if (!stored) return [];
      return JSON.parse(stored);
    } catch (error) {
      void logger.error('Error loading metadata', error, 'SkinStorageService');
      return [];
    }
  }

  static async deleteSkin(skinId: string): Promise<void> {
    try {
      await invoke('delete_skin_file', { skinId });

      const metadata = await this.getSkinsMetadata();
      const filtered = metadata.filter(m => m.id !== skinId);
      localStorage.setItem(SKINS_METADATA_KEY, JSON.stringify(filtered));
    } catch (error) {
      void logger.error('Error deleting skin', error, 'SkinStorageService');
      throw new Error('Error al eliminar skin');
    }
  }

  static async setActiveSkin(skinId: string): Promise<void> {
    try {
      const metadata = await this.getSkinsMetadata();
      const updated = metadata.map(m => ({
        ...m,
        isActive: skinId !== '' && m.id === skinId
      }));

      localStorage.setItem(SKINS_METADATA_KEY, JSON.stringify(updated));
      localStorage.setItem(ACTIVE_SKIN_KEY, skinId || '');
    } catch (error) {
      void logger.error('Error setting active skin', error, 'SkinStorageService');
      throw new Error('Error al establecer skin activa');
    }
  }

  static async getActiveSkin(): Promise<SkinData | null> {
    try {
      const activeSkinId = localStorage.getItem(ACTIVE_SKIN_KEY);
      if (!activeSkinId) return null;

      const skins = await this.getStoredSkins();
      return skins.find(s => s.id === activeSkinId) || null;
    } catch (error) {
      void logger.error('Error getting active skin', error, 'SkinStorageService');
      return null;
    }
  }

  static async clearAllSkins(): Promise<void> {
    try {
      const metadata = await this.getSkinsMetadata();
      
      for (const meta of metadata) {
        try {
          await invoke('delete_skin_file', { skinId: meta.id });
        } catch (err) {
        }
      }

      localStorage.removeItem(SKINS_METADATA_KEY);
      localStorage.removeItem(ACTIVE_SKIN_KEY);
    } catch (error) {
      void logger.error('Error clearing skins', error, 'SkinStorageService');
      throw new Error('Error al limpiar skins');
    }
  }

  static getCrafatarPreviewUrl(uuid: string): string {
    return `https://crafatar.com/renders/body/${uuid}?overlay=true`;
  }

  static getCrafatarHeadUrl(uuid: string, size: number = 40): string {
    return `https://crafatar.com/avatars/${uuid}?size=${size}&overlay=true`;
  }

  static getAvatarUrl(uuid: string, size: number = 40, overlay: boolean = true): string {
    return `https://crafatar.com/avatars/${uuid}?size=${size}${overlay ? '&overlay=true' : ''}`;
  }
}
