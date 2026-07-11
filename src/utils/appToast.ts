import { toast } from "vibe-toast";

export type AppToastType = "success" | "error" | "info";

export function addAppToast(
  message: string,
  type: AppToastType = "info",
  duration = 5000
) {
  const opts = { duration };
  if (type === "success") toast.success(message, opts);
  else if (type === "error") toast.error(message, opts);
  else toast.info(message, opts);
}
