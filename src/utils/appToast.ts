import { toast } from "vibe-toast";

export type AppToastType = "success" | "error" | "info";

// Only one toast should ever be visible at a time - showing several at once
// (e.g. "Capa activada" + "Skin actualizada" back to back) feels intrusive.
// Dismissing whatever is currently showing before raising a new one keeps
// this true app-wide without every call site having to coordinate.
export function addAppToast(
  message: string,
  type: AppToastType = "info",
  duration = 5000
) {
  toast.dismissAll();
  const opts = { duration };
  if (type === "success") toast.success(message, opts);
  else if (type === "error") toast.error(message, opts);
  else toast.info(message, opts);
}
