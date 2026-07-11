import { invoke } from '@tauri-apps/api/core';

export interface Session {
  id: string;
  username: string;
  uuid: string; // UUID de Minecraft para la skin
  access_token: string;
  refresh_token: string | null;
  expires_at: number; // Unix timestamp in seconds
  created_at: number; // Unix timestamp in seconds
  updated_at: number; // Unix timestamp in seconds
}

export class SessionService {
  static async saveSession(
    username: string,
    uuid: string,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: number
  ): Promise<string> {
    return await invoke<string>('save_session', {
      username,
      uuid,
      accessToken,
      refreshToken,
      expiresAt
    });
  }

  static async getSession(username: string): Promise<Session | null> {
    return await invoke<Session | null>('get_session', { username });
  }

  static async getActiveSession(): Promise<Session | null> {
    return await invoke<Session | null>('get_active_session');
  }

  static async refreshActiveSession(username: string): Promise<Session> {
    return await invoke<Session>('refresh_session', { username });
  }

  static async validateAndRefreshToken(username: string): Promise<Session> {
    return await invoke<Session>('validate_and_refresh_token', { username });
  }

  static async getDbPath(): Promise<string> {
    return await invoke<string>('get_db_path');
  }

  static async clearUpdateState(): Promise<string> {
    return await invoke<string>('clear_update_state');
  }

  static async updateSession(session: Session): Promise<string> {
    return await invoke<string>('update_session', { session });
  }

  static async deleteSession(username: string): Promise<string> {
    return await invoke<string>('delete_session', { username });
  }

  static async clearAllSessions(): Promise<string> {
    return await invoke<string>('clear_all_sessions');
  }

  static async cleanupExpiredSessions(): Promise<number> {
    return await invoke<number>('cleanup_expired_sessions');
  }

  static async debugSessions(): Promise<string> {
    return await invoke<string>('debug_sessions');
  }

  static isSessionExpired(session: Session): boolean {
    return session.expires_at < Date.now() / 1000;
  }

  static isSessionExpiringSoon(session: Session, minutesThreshold: number = 10): boolean {
    const threshold = (Date.now() / 1000) + (minutesThreshold * 60);
    return session.expires_at <= threshold;
  }
}
