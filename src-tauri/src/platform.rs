//! Per-platform tweaks that must run before the webview exists.

/// WebKitGTK variables that stop the window from coming up blank or crashing with
/// `EGL_BAD_PARAMETER` on common Linux setups.
///
/// The DMA-BUF renderer breaks on the proprietary NVIDIA driver, and the AppImage ships a
/// WebKit built against older Mesa than most rolling distros have.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_webkit_env(is_appimage: bool, has_nvidia: bool) -> Vec<(&'static str, &'static str)> {
    if is_appimage || has_nvidia {
        vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]
    } else {
        Vec::new()
    }
}

/// Applies the workarounds without overriding anything the user already set, so
/// `WEBKIT_DISABLE_DMABUF_RENDERER=0` still wins.
#[cfg(target_os = "linux")]
pub fn apply_linux_webkit_workarounds() {
    let is_appimage = std::env::var_os("APPIMAGE").is_some();
    let has_nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();

    for (key, value) in linux_webkit_env(is_appimage, has_nvidia) {
        if std::env::var_os(key).is_none() {
            // SAFETY: called at the top of `run`, before any thread is spawned.
            unsafe { std::env::set_var(key, value) };
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn apply_linux_webkit_workarounds() {}

#[cfg(test)]
mod tests {
    use super::linux_webkit_env;

    #[test]
    fn appimage_disables_the_dmabuf_renderer() {
        assert_eq!(linux_webkit_env(true, false), vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
    }

    #[test]
    fn nvidia_disables_the_dmabuf_renderer() {
        assert_eq!(linux_webkit_env(false, true), vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
    }

    #[test]
    fn other_setups_are_left_alone() {
        assert!(linux_webkit_env(false, false).is_empty());
    }
}
