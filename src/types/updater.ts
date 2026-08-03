export interface UpdateState {
  last_check: string;
  available_version: string | null;
  current_version: string;
  downloaded: boolean;
  download_ready: boolean;
  manual_download: boolean;
}

export interface UpdateProgress {
  current: number;
  total: number;
  percentage: number;
  status: string;
}
