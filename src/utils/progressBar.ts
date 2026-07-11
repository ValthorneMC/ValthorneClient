import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window';

export async function showIndeterminateProgressBar(): Promise<void> {
  try {
    await getCurrentWindow().setProgressBar({ status: ProgressBarStatus.Indeterminate });
  } catch {}
}

export async function hideProgressBar(): Promise<void> {
  try {
    await getCurrentWindow().setProgressBar({ status: ProgressBarStatus.None });
  } catch {}
}

