import { SkinData } from '@/types/skin';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';

const SKINS_METADATA_KEY = 'valthorne_user_skins_metadata';
const ACTIVE_SKIN_KEY = 'valthorne_active_skin';
const ACTIVE_CAPE_KEY = 'valthorne_active_cape';

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

      const files = new Set(skinFiles);
      const skins: SkinData[] = new Array(metadata.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(8, metadata.length) }, async () => {
        while (next < metadata.length) {
          const index = next++;
          skins[index] = await this.readSkin(metadata[index], files);
        }
      }));
      return skins;
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

  static async getActiveSkin(loadedSkins?: readonly SkinData[]): Promise<SkinData | null> {
    try {
      const activeSkinId = localStorage.getItem(ACTIVE_SKIN_KEY);
      if (!activeSkinId) return null;
      if (loadedSkins) return loadedSkins.find(s => s.id === activeSkinId) || null;

      const metadata = (await this.getSkinsMetadata()).find(meta => meta.id === activeSkinId);
      if (!metadata) return null;
      const files = new Set(await invoke<string[]>('list_skin_files'));
      return await this.readSkin(metadata, files);
    } catch (error) {
      void logger.error('Error getting active skin', error, 'SkinStorageService');
      return null;
    }
  }

  private static async readSkin(meta: any, files: ReadonlySet<string>): Promise<SkinData> {
    let fileData: ArrayBuffer | undefined;
    if (files.has(meta.id)) {
      try {
        const bytes = await invoke<number[]>('load_skin_file', { skinId: meta.id });
        fileData = new Uint8Array(bytes).buffer;
      } catch (error) {
        void logger.error(`Error loading fileData for skin ${meta.id}`, error, 'SkinStorageService');
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
      fileData,
    };
  }

  // --- Cape metadata (capes themselves live server-side on Mojang; we only cache the
  // locally-known active cape id for optimistic UI while a set/remove request is in flight) ---

  static getLocalActiveCapeId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_CAPE_KEY);
    } catch (error) {
      void logger.error('Error reading active cape', error, 'SkinStorageService');
      return null;
    }
  }

  static setLocalActiveCapeId(capeId: string | null): void {
    try {
      if (capeId) {
        localStorage.setItem(ACTIVE_CAPE_KEY, capeId);
      } else {
        localStorage.removeItem(ACTIVE_CAPE_KEY);
      }
    } catch (error) {
      void logger.error('Error saving active cape', error, 'SkinStorageService');
    }
  }
}
