<p align="center">
  <img src="Valthorne%20Client.png" alt="Valthorne Client" width="480">
</p>

# Valthorne Client

[![Tauri](https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app) [![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org) [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)

Cliente oficial de **Valthorne**.

## Instalación

Descarga el instalador de tu sistema desde el [último release](https://github.com/ValthorneMC/ValthorneClient/releases/latest).

### Windows

Ejecuta el `.exe` o el `.msi`.

### macOS

La app está firmada ad-hoc y no notarizada, así que Gatekeeper la bloquea al abrirla por primera vez (aparece como "dañada").

1. Abre el `.dmg` y **arrastra la app a la carpeta Aplicaciones**. No la ejecutes desde el DMG ni desde Descargas: desde ahí macOS la aísla en modo solo lectura y no podrá actualizarse sola.
2. Quita la "cuarentena":

   ```bash
   xattr -cr "/Applications/Valthorne Client.app"
   ```

3. Ábrela con normalidad.

Hay dos builds: `aarch64` (Apple Silicon) y `x64` (Intel).

### Linux

Solo x86_64. Elige un formato:

| Formato | Distros | Notas |
|---|---|---|
| `.deb` | Debian, Ubuntu, Mint | `sudo apt install ./valthorne-client_*.deb` |
| `.rpm` | Fedora, openSUSE | `sudo dnf install ./valthorne-client-*.rpm` |
| `.AppImage` | Cualquiera con glibc 2.35+ | `chmod +x *.AppImage`; requiere FUSE 2 (`libfuse2`, o `libfuse2t64` en Ubuntu 24.04) |

Si la ventana sale en blanco, el launcher ya desactiva el renderer DMA-BUF de WebKit en AppImage y con drivers NVIDIA propietarios. Para forzarlo o revertirlo: `WEBKIT_DISABLE_DMABUF_RENDERER=1` (o `=0`).

El juego usa su propio Java (se descarga solo en `~/.valthorneclient/runtime`). Si Minecraft no abre, revisa que el sistema tenga los drivers de OpenGL de tu GPU.

## Datos del usuario

Todos los datos del cliente viven en `~/.valthorneclient` (en Windows, `%USERPROFILE%\.valthorneclient`): la instancia, los runtimes de Java, las skins y las configs del cliente.

---

# Valthorne Client 🇺🇸

[![Tauri](https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app) [![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org) [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)

Official client for **Valthorne**.

## Installation

Download the installer for your system from the [latest release](https://github.com/ValthorneMC/ValthorneClient/releases/latest).

### Windows

Run the `.exe` or the `.msi`.

### macOS

The app is ad-hoc signed and not notarized, so Gatekeeper blocks it the first time you open it (it shows up as "damaged").

1. Open the `.dmg` and **drag the app to the Applications folder**. Do not run it from the DMG or from Downloads: macOS isolates it in read-only mode there and it will not be able to update itself.
2. Remove the quarantine flag:

   ```bash
   xattr -cr "/Applications/Valthorne Client.app"
   ```

3. Open it as usual.

There are two builds: `aarch64` (Apple Silicon) and `x64` (Intel).

### Linux

x86_64 only. Pick a format:

| Format | Distros | Notes |
|---|---|---|
| `.deb` | Debian, Ubuntu, Mint | `sudo apt install ./valthorne-client_*.deb` |
| `.rpm` | Fedora, openSUSE | `sudo dnf install ./valthorne-client-*.rpm` |
| `.AppImage` | Any distro with glibc 2.35+ | `chmod +x *.AppImage`; needs FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04) |

If the window comes up blank, the launcher already disables WebKit's DMA-BUF renderer on AppImage and with the proprietary NVIDIA driver. To force or revert it, set `WEBKIT_DISABLE_DMABUF_RENDERER=1` (or `=0`).

The game uses its own Java (downloaded automatically into `~/.valthorneclient/runtime`). If Minecraft does not start, make sure your system has the OpenGL drivers for your GPU.

## User data

All client data lives in `~/.valthorneclient` (on Windows, `%USERPROFILE%\.valthorneclient`): the instance, the Java runtimes, skins and the client configs.


[!NOTE]

At Valthorne we're open to receive PRs an issues, although we prefer being contacted on Discord before submitting a PR or issue.
If you aren't in our [Discord](https://discord.playvalthorne.com) (Spanish & English community), you are completely welcome!