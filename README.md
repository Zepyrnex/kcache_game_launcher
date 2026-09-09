# Kcache

**Kcache** is a GPU shader cache manager and game launcher built for PC gamers. It scans, monitors, and optimizes shader cache files across GPU vendors while providing a game launcher with total storage tracking and playtime monitoring.

## Download

Download the latest installer for Windows 10/11:
- [**Download Kcache v0.1.0 (Windows Installer .exe)**](https://github.com/Zepyrnex/kcache_game_launcher/releases/download/v0.1.0/Kcache_0.1.0_x64-setup.exe)
- [View all Releases](https://github.com/Zepyrnex/kcache_game_launcher/releases)

---

## Features

- **GPU Shader Cache Management**: Automatically detects and manages shader caches across NVIDIA (DX, GL, NV_Cache), AMD, DirectX, and Vulkan.
- **Game Library Scanner**: Detects installed games across Steam, Epic Games Store, and custom install directories.
- **Total Storage Breakdown**: Calculates and displays full disk space consumed by game install files and related shader caches.
- **Playtime Tracker**: Built-in background playtime monitor (0% CPU idle, <50 KB RAM) that tracks session and lifetime playtime.
- **Custom Executable Paths**: Set and change game target launch executables and working directories on the fly.
- **Native Windows Installer**: Built with Tauri v2 and NSIS, with clean desktop shortcuts and an included `uninstall.exe`.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite, Lucide React
- **Backend**: Rust, Tauri v2, SQLite (bundled via `rusqlite`), Tokio
- **Installer**: NSIS (Nullsoft Scriptable Install System)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (1.77+)
- Visual Studio C++ Build Tools

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Production Build

```bash
# Build frontend and generate Windows NSIS installer
npm run tauri build -- --bundles nsis
```

The installer executable will be generated at:
`src-tauri/target/release/bundle/nsis/Kcache_0.1.0_x64-setup.exe`
