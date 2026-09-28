# Research: Electron vs Tauri (2026)

Decided (D10): **Electron**, with a deliberately thin shell. Researched 2026-09-27.

## The facts

- **Tauri v2 is stable** (v2.10.1 as of March 2026) and is the default recommendation in most 2026 guides. Its selling points:
  - bundles of 5–10 MB vs 80–200 MB for Electron
  - 20–100 MB of RAM at idle
  - a capability-based security model with privileged code in Rust
  - iOS and Android targets
- **Electron** ships its own Chromium, so rendering is identical everywhere and gets the newest web features first; its packaging and updater ecosystem is the most mature. Desktop only.
- **Tauri on macOS uses WKWebView:**
  - it's tied to the OS version, so unsupported macOS versions stop getting WebKit updates
  - CSS renders slightly differently across the three platform web views
  - there are **open issues where transparent windows work in development but render opaque in production builds**

## Why Electron for Studio

1. **UI quality is the top priority** (D9). A controlled, consistent rendering engine matters more than bundle size, and transparency/vibrancy is part of the native feel we want.
2. **The size and RAM arguments are weaker here.** The always-on work runs in the separate kernel daemon (D11); the GUI only needs to be open while you look at it. The exception is Electron's menu-bar process (~100+ MB).
3. **Language parity is moot.** The kernel is its own Node daemon either way, and the UI is React in both cases. Tauri's Rust part would be a thin shell (window, tray, notifications, Keychain, autostart plugins).
4. **Switching later is cheap.** The UI talks to the kernel over the loopback API, so replacing the shell is days of work, not a rewrite.

## Revisit when

Mobile ("Wright on your phone") or wide distribution, where download size and RAM are judged, becomes a goal.

## Sources

- [Tauri v2 vs Electron 2026: The Honest Comparison](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026)
- [Desktop Apps from Web: Tauri vs Electron vs Deno 2026](https://www.digitalapplied.com/blog/desktop-apps-web-stack-tauri-electron-deno-wails-2026)
- [Tauri vs Electron 2026 — Rustify](https://rustify.rs/articles/rust-tauri-vs-electron-2026)
- [Why I Chose Tauri v2 for a Desktop Overlay in 2026](https://dev.to/manasightgg/why-i-chose-tauri-v2-for-a-desktop-overlay-in-2026-597h)
- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)
