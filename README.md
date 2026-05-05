# Codex Workbench

Codex Workbench is a Windows laptop + iPhone remote companion for local Codex work. The Windows side runs a local Node bridge that serves the PWA, reads `~/.codex` sessions, sends messages through Codex Desktop / CLI / app-server where available, manages trusted phone devices, keeps a phone URL, and exposes diagnostics. The iPhone side is a Home Screen friendly PWA designed to feel like an app rather than a debug webpage.

## Current Remodex parity status

- PWA-first route is selected: the near-native score is 87/100 in `docs/remodex-parity.md`.
- Source-level Remodex mapping table is in `docs/remodex-parity.md`.
- The iOS SwiftUI project remains a reusable native route, but it was not built or device-tested on Windows.
- Workbench does not claim APNs, full native background execution, full E2E relay, or perfect Codex Desktop live mirroring.

## Main capabilities

- Standard QR/short-code pairing with one-time expiry.
- Trusted-device login, rename, revoke, and ¡°forget this browser¡±.
- Hashed access/refresh token storage and hashed trusted-device token storage on the server.
- `/api/system/status` and `/api/system/diagnostics` with bridge state, public-link state, PWA version, token/device diagnostics, WebSocket clients, Codex checks, and user actions.
- iPhone PWA layout with manifest/icon/standalone mode, safe-area handling, VisualViewport keyboard handling, bottom composer, virtual long-thread rendering, and stale-cache refresh.
- Send queue with local stages, attachment progress, finite retry, stale cleanup, retry/cancel, and server follow-up edit/reorder/cancel/auto-drain.
- Runtime controls for model, reasoning effort, access mode, and Plan prompt fallback with capability disclosure per send mode.
- Subagent tree display plus explicit `/subagents` command fallback.
- Safe Git panel: status/branch/files/shortstat/commits plus confirmed commit, pull `--ff-only`, push, checkout existing branch, create branch, and stash.
- Thread-scoped uploads with image/PDF/docx/audio cards, camera capture input, MediaRecorder voice attachment when supported, and voice-memo fallback.
- In-app reminder center, optional browser notifications, WebSocket reconnect, foreground catch-up, and service-worker cache recovery.
- Windows Task Scheduler autostart scripts with duplicate-start guard, port guard, restart loop, and logs.

## Quick start on the Windows laptop

```powershell
npm install
npm run build
npm start
```

Open the local page on the computer:

```text
http://127.0.0.1:8787/
```

For phone access on a different network, prefer Tailscale/Funnel:

```powershell
npm run start:public
```

Then open `current-phone-link.txt`. It contains:

- `Phone`: the URL to open on iPhone.
- `Computer`: the local computer URL.
- `UpdatedAt`: last update time.
- `TunnelType`: Tailscale, Cloudflare, localhost.run, custom, or recovering.
- `FailureReason`: why the tunnel is recovering, if any.

Do not share the phone URL with untrusted people. The URL is protected by password/trusted-device auth, but it still exposes your local bridge login surface.

## First iPhone pairing

1. Open Workbench on the computer and sign in with the access password.
2. Open `Advanced` ¡ú `Pairing` ¡ú `Create pairing code`.
3. Scan the QR code with iPhone, or open the pairing URL, or type the short code.
4. The phone becomes a trusted device and returns to the main Workbench screen.
5. Later, open the Home Screen icon or stable URL. If the password screen appears, tap `Trusted login`.

Password login remains the recovery path. If a phone is revoked, its HTTP token and WebSocket access stop working and the phone must use password or pair again.

## Send modes and runtime controls

Set `CODEX_SEND_MODE` in `.env` or the environment:

- `desktop`: uses Codex Desktop UI automation. Reliable for sending text, but reasoning/access controls are marked as unsupported or prompt fallback.
- `cli`: uses Codex CLI `exec resume` and passes model/reasoning/approval/sandbox options where supported.
- `app-server`: uses Codex app-server JSON-RPC when available and falls back to CLI on failure.

Plan Mode is explicit prompt fallback unless a stable native API is available. Full access requires confirmation in the UI and should only be used on trusted local projects.

## Git safety

Phone Git actions are safe by default. Read-only status is always first. Write actions require confirmation text:

```text
confirm:commit
confirm:pull
confirm:push
confirm:checkout
confirm:create-branch
confirm:stash
```

High-risk actions are not exposed: reset, clean, force push, branch delete, rebase, and arbitrary checkout paths.

## Autostart

Install Windows login autostart:

```powershell
.\scripts\install-autostart.ps1
```

Remove it:

```powershell
.\scripts\uninstall-autostart.ps1
```

Logs:

- `autostart.log`: startup, duplicate guard, and restart notices.
- `public-link.log`: tunnel/service output.
- `current-phone-link.txt`: the current phone URL and tunnel state.

If the computer is off, sleeping, offline, or the tunnel is down, the phone cannot reach Codex. Queued messages stored in the browser are not intentionally discarded; when the phone reconnects, Workbench rechecks status and resumes safely.

## Verification

Run before release:

```powershell
npm test
npm run build
```

Optional HTTP smoke test after `npm start`:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/
Invoke-WebRequest http://127.0.0.1:8787/api/client-meta
```

Manual iPhone checks are listed in `docs/remodex-parity.md` because Windows cannot automate real iPhone Safari keyboard, Home Screen PWA, or Xcode device verification.
