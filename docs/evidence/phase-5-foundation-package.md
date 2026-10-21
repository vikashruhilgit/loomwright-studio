# Phase 5 foundation: `npm run package` evidence

This is a one-time record for phase 5 item 01, Criterion 7. CI runs on ubuntu, so the macOS package step was run once on the owner's Mac (by the implementing agent) and its output is recorded here. Run on 2026-10-21 at about 03:08 UTC, on macOS 26.6.2 (25G83), Apple Silicon (arm64), Node v24.11.1, from the phase 5 foundation branch based on `3a20ac8`.

**Owner action before approving.** The `open` check below ran while the login session was locked, so the window existed but nobody could see it (see "Opens with no terminal"). Run `open "app/release/mac-arm64/Loomwright Studio.app"` once yourself, look at the window, and record what you saw here.

## The package command and its output tail

```
cd app && npm run package
# = npm run build && electron-builder --mac dir --publish never
```

```
  • electron-builder  version=26.15.3 os=25.6.0
  • loaded configuration  file=package.json ("build" field)
  • executing @electron/rebuild  electronVersion=44.9.2 arch=arm64 buildFromSource=false …
  • installing native dependencies  arch=arm64
  • completed installing native dependencies
  • packaging       platform=darwin arch=arm64 electron=44.9.2 appOutDir=release/mac-arm64
  • downloaded      label=electron progress=100%
  • downloaded electron zip extracted successfully  output=…/app/release/mac-arm64
  • searching for node modules  pm=npm searchDir=…/app
  • default Electron icon is used  reason=application icon is not set
  • signing         file=release/mac-arm64/Loomwright Studio.app platform=darwin type=distribution identityName=- identityHash=none provisioningProfile=none
  • skipped macOS notarization  reason=`notarize` options were set explicitly `false`
```

Exit code 0. The output is `app/release/mac-arm64/Loomwright Studio.app` (288 MB). `app/release/` is gitignored. The configuration is the `build` field of [`app/package.json`](../../app/package.json): `mac.identity: "-"` (ad-hoc), `hardenedRuntime: false`, `notarize: false`, `target: dir`, `publish: null`, `productName: "Loomwright Studio"`, and `protocols` with the scheme `loomwright-studio`. It is never published and not notarised (D20, and the owner's packaging decision). The bundle uses Electron's default icon, because no app icon is designed yet. That icon is the Electron logo, which neither says nor looks like "Claude Code" (invariant 7).

## `codesign -dv` on the bundle: an ad-hoc signature

```
$ codesign -dv "Loomwright Studio.app"
Executable=…/app/release/mac-arm64/Loomwright Studio.app/Contents/MacOS/Loomwright Studio
Identifier=dev.loomwright.studio
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=430 flags=0x2(adhoc) hashes=3+7 location=embedded
Signature=adhoc
Info.plist entries=33
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=10
Internal requirements count=0 size=12

$ codesign --verify --deep --strict "Loomwright Studio.app"; echo $?
0
```

## The URL scheme in the built `Info.plist`

```
$ /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "Loomwright Studio.app/Contents/Info.plist"
Array {
    Dict {
        CFBundleTypeRole = Editor
        CFBundleURLName = Loomwright Studio link
        CFBundleURLSchemes = Array {
            loomwright-studio
        }
    }
}
```

`CFBundleIdentifier`, `CFBundleName`, `CFBundleDisplayName` and `CFBundleExecutable` are `dev.loomwright.studio`, `Loomwright Studio`, `Loomwright Studio` and `Loomwright Studio`. After the `open` below, the LaunchServices database (`lsregister -dump`) lists the scheme as claimed by the `dev.loomwright.studio` record: `claimed schemes: loomwright-studio:`, with `claim id: Loomwright Studio link`, `roles: Editor` and `bindings: loomwright-studio:`. A side effect worth knowing: until the owner registers another build, `loomwright-studio://` links on this Mac now open this worktree's build.

## Opens with no terminal (LaunchServices)

The login session is a GUI one (`launchctl managername` printed `Aqua`), and the Playwright Electron smoke opened real windows in it earlier in the same run. Then:

```
$ open "…/app/release/mac-arm64/Loomwright Studio.app"; echo "open rc=$?"
open rc=0                                    # 2026-10-21T03:08:58Z

$ ps -o pid,ppid,user,comm -p "$(pgrep -x 'Loomwright Studio')"
  PID  PPID USER        COMM
91568     1 vikashruhil …/Loomwright Studio.app/Contents/MacOS/Loomwright Studio
```

What was observed:

- **The process ran under launchd, not a terminal.** Its parent is pid 1 (`/sbin/launchd`), and `lsappinfo` lists it as `Loomwright Studio` with `launchedby=[ NULL ]`.
- **It created its window.** CoreGraphics' window list (`CGWindowListCopyWindowInfo`, read through `osascript -l JavaScript`) shows exactly one layer-0 window owned by pid 91568, named `Loomwright Studio`, reported on screen with alpha 1. The app shows its window only on `ready-to-show`, so the renderer had loaded.
- **Not observed: the window as a person would see it.** At the time, `lsappinfo front` named `loginwindow` as the frontmost process, so the session was locked. Stage Manager is on (`com.apple.WindowManager GloballyEnabled = 1`). The window's reported bounds were 157×143 at x = −233, which looks like a Stage Manager strip thumbnail, not the app's 1180×760 frame. No screenshot was taken, and nobody looked at the screen. So this file does **not** claim the app was seen opening from Finder or the Dock. The owner's one `open` check, in the action at the top, closes this gap.

The app made one read-only `GET /status` call to the owner's running kernel (`~/.loomwright-studio/api.json` existed), with the Keychain token, from the main process. Afterwards it was quit with `osascript -e 'tell application id "dev.loomwright.studio" to quit'`, and no `Loomwright Studio` process was left.

## Dependencies installed for phase 5

Every dependency later items need is installed now, so none of them touches `app/package.json` (versions as resolved in `app/package-lock.json`):

| Package | Version | Kind | For |
|---|---|---|---|
| `ws` | 8.22.0 | dependency | The main process's feed client (the kernel's `GET /events/stream`), and the fixture kernel's feed |
| `electron` | 44.9.2 | dev | The app shell |
| `electron-builder` | 26.15.3 | dev | `npm run package` |
| `react`, `react-dom` | 19.3.1 | dev (bundled by Vite) | The renderer |
| `vite` | 8.3.4 | dev | The renderer build, and the main and preload build (`scripts/build-electron.mjs`) |
| `@vitejs/plugin-react` | 6.1.2 | dev | Vite's React support |
| `typescript` | 7.0.2 | dev | `npm run typecheck` |
| `vitest` | 5.0.5 | dev | `npm test` |
| `@testing-library/react` | 16.3.3 | dev | Renderer tests |
| `@testing-library/dom` | 10.4.2 | dev | Required companion of `@testing-library/react` |
| `jsdom` | 30.1.3 | dev | The renderer tests' DOM |
| `@playwright/test` | 1.64.1 | dev | The Electron smoke and each screen's e2e |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/ws` | 22.20.5, 19.3.0, 19.3.0, 8.18.2 | dev | Types |
| **`@react-spring/web`** | **10.1.2** | dev (bundled) | **The one spring library for the avatar's gestures (item 09 may use only this one; `motion` is not installed)** |

Electron 44 downloads its binary (about 100 MB) on first use, not on `npm ci`. The CI `app` job fetches it explicitly with `node node_modules/electron/install.js` before the smoke.
