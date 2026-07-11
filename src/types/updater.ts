export interface UpdateState {
  last_check: string;
  available_version: string | null;
  current_version: string;
  downloaded: boolean;
  download_ready: boolean;
  manual_download: boolean;
}

export interface UpdateInfo {
  version: string;
  available: boolean;
  message: string;
  download_progress?: number;
  download_ready?: boolean;
}

export interface UpdateProgress {
  current: number;
  total: number;
  percentage: number;
  status: string;
}
