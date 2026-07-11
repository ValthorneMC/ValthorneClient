import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UpdateState, UpdateProgress } from '@/types/updater';
import { logger } from '@/utils/logger';

export interface UpdateInfo {
  version: string;
  available: boolean;
  message: string;
  download_progress?: number;
  download_ready?: boolean;
}

export class UpdaterService {
  private static progressCallback: ((progress: UpdateProgress) => void) | null = null;


  static async getUpdateState(): Promise<UpdateState> {
    try {
      return await invoke<UpdateState>('get_update_state');
    } catch (error) {
      void logger.error('Error getting update state', error, 'UpdaterService');
      throw error;
    }
  }


  static async checkForUpdates(): Promise<UpdateInfo> {
    try {
      const result = await invoke<string>('check_for_updates');
      const available = !result.includes('No updates available');

      return {
        version: available ? result.replace('Update available: ', '') : '',
        available,
        message: result
      };
    } catch (error) {
      console.error('Error checking for updates:', error);
      return {
        version: '',
        available: false,
        message: 'Error al verificar actualizaciones'
      };
    }
  }

  
  static async downloadUpdateSilent(manual: boolean = false): Promise<{ success: boolean; message: string }> {
    try {
      const result = await invoke<string>('download_update_silent', { manual });
      return {
        success: result.includes('downloaded successfully'),
        message: result
      };
    } catch (error) {
      void logger.error('Error downloading update', error, 'UpdaterService');
      return {
        success: false,
        message: 'Error al descargar la actualización'
      };
    }
  }
  static async installUpdate(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await invoke<string>('install_update');
      return {
        success: result.includes('successfully') || result.includes('No updates available'),
        message: result
      };
    } catch (error) {
      console.error('Error installing update:', error);
      return {
        success: false,
        message: 'Error al instalar la actualización'
      };
    }
  }

  static async installUpdateWithConfirm(): Promise<{ success: boolean; message: string }> {
    const state = await this.getUpdateState();
    if (!state.download_ready) {
      return {
        success: false,
        message: 'No hay actualización lista para instalar. Descarga la actualización primero.'
      };
    }

    return this.installUpdate();
  }


  static async getCurrentVersion(): Promise<string> {
    try {
      const state = await this.getUpdateState();
      return state.current_version;
    } catch (error) {
      void logger.error('Error getting current version', error, 'UpdaterService');
      try {
        const resp = await fetch('/package.json');
        if (resp.ok) {
          const pkg = await resp.json();
          if (pkg && pkg.version) return pkg.version;
        }
      } catch (e1) {
      }
      try {
        const resp2 = await fetch('/tauri.conf.json');
        if (resp2.ok) {
          const conf = await resp2.json();
          if (conf && conf.version) return conf.version;
        }
      } catch (e2) {
      }
      return '0.1.0';
    }
  }


  static setProgressCallback(callback: (progress: UpdateProgress) => void) {
    this.progressCallback = callback;
  }


  static async startListeningToEvents() {
    try {

      await listen('update-download-progress', (event) => {
        if (this.progressCallback) {
          this.progressCallback({
            current: event.payload as number,
            total: 100,
            percentage: event.payload as number,
            status: 'Descargando...'
          });
        }
      });


      await listen('update-download-start', () => {
        if (this.progressCallback) {
          this.progressCallback({
            current: 0,
            total: 100,
            percentage: 0,
            status: 'Iniciando descarga...'
          });
        }
      });


      await listen('update-download-complete', () => {
        if (this.progressCallback) {
          this.progressCallback({
            current: 100,
            total: 100,
            percentage: 100,
            status: 'Descarga completada'
          });
        }
      });


      await listen('update-install-start', () => {
        if (this.progressCallback) {
          this.progressCallback({
            current: 0,
            total: 100,
            percentage: 0,
            status: 'Instalando actualización...'
          });
        }
      });


      await listen('update-install-complete', () => {
        if (this.progressCallback) {
          this.progressCallback({
            current: 100,
            total: 100,
            percentage: 100,
            status: 'Instalación completada'
          });
        }
      });
    } catch (error) {
      console.error('Error setting up update event listeners:', error);
    }
  }


  static async shouldCheckForUpdates(): Promise<boolean> {
    try {
      const state = await this.getUpdateState();
      if (!state.last_check || state.last_check === '') {
        return true; // Nunca se ha verificado
      }
      const lastCheck = new Date(state.last_check);
      const now = new Date();
      const minutesDiff = (now.getTime() - lastCheck.getTime()) / (1000 * 60);
      
      // Verificar cada 30 minutos (en lugar de 6 horas)
      return minutesDiff >= 30;
    } catch (error) {
      void logger.error('Error checking if should update', error, 'UpdaterService');
      return true;
    }
  }
}
