# Codex iOS

Native SwiftUI client for the Codex service running on a Windows computer.

## Scope

This project is intentionally not a WKWebView wrapper. The browser/PWA version stays in place, while this iOS target uses native SwiftUI screens, Keychain-backed auth storage, and the stable Mobile API v1 contract exposed by the Windows service.

## Open In Xcode

Open:

```sh
ios/CodexWorkbench/CodexWorkbench.xcodeproj
```

Scheme:

```sh
CodexWorkbench
```

Chinese step-by-step iPhone installation:

```text
ios/CodexWorkbench/INSTALL_ZH.md
```

## Computer Service

The default Host URL is:

```text
http://192.168.1.204:8787/
```

Users can change it in the sign-in screen or Settings. On the same Wi-Fi, use the Windows computer LAN URL. From another network, use the public phone link created by the existing browser service. `Info.plist` includes `NSLocalNetworkUsageDescription` and `NSAppTransportSecurity.NSAllowsLocalNetworking` for first-party local-network access.

## Implemented

- SwiftUI app entry and tab/navigation shell.
- Project list, thread list, chat detail, auth, and settings screens.
- `GET /api/mobile/v1/bootstrap` discovery for API version, capabilities, endpoints, runtime, model, upload limits, and public link metadata.
- Password setup through `POST /api/auth/setup`, login through `POST /api/auth/login`, and refresh through `POST /api/auth/refresh`.
- Trusted iPhone pairing through `POST /api/pairing/complete`, trusted-device login through `POST /api/auth/device-login`, and trusted-device management through `/api/devices`.
- `APIClient` with async/await endpoints for auth, bootstrap, trusted devices, projects, threads, native new chat creation, paged thread detail, messages, cancel, retry, model list, attachment upload, and attachment-backed send.
- `WebSocketClient` is integrated into `ChatView` with reconnect, live/offline status, immediate run-state updates, and low-latency detail refresh for current-thread events.
- Native local notifications through `UserNotifications` for current-thread completion/failure alerts, with foreground catch-up refresh when the app becomes active.
- Native handoff from an iPhone chat to the Windows desktop through `POST /api/threads/{threadId}/open-desktop`.
- Native local send queue in `ChatView` with visible queued/uploading/sending/submitted/failed states, retry/dismiss controls, sequential processing, and server follow-up handoff when a run is already active.
- Native new chat action in the project conversation list, backed by `POST /api/threads/new`, with automatic selection of the created chat.
- Native conversation search in the project thread list, including title/model/path matching and an empty-result state.
- Native Files picker in the chat composer with attachment cards, upload limit checks, remove/retry controls, thread-scoped uploads, and returned upload paths attached to the next send.
- Native runtime controls in `ChatView` for per-chat model, reasoning effort, access mode, and Plan Mode, backed by `/api/runtime/defaults` and `/api/threads/{threadId}/runtime`.
- `AppState.bootstrap()` uses `KeychainTokenStore` by default for access/refresh tokens and trusted-device credentials.
- Native models for projects, threads, messages, paged thread detail, run state, auth session, bootstrap, models, runtime controls, and attachments.
- Settings show computer connection state, Mobile API version, build id, send mode, upload limits, current trusted iPhone, trusted-device list, rename, forget, revoke actions, and notification permission controls.
- Privacy manifest with no collected data declared for the current native target.
- XCTest coverage for host URL normalization.

## Build Notes

This Windows workspace can edit and test source-level contracts, but it cannot build, sign, or run the iOS target. For a real device build:

1. Open `ios/CodexWorkbench/CodexWorkbench.xcodeproj` on a Mac with Xcode.
2. Set the signing team and bundle identifier if needed.
3. Run the `CodexWorkbench` scheme on an iPhone or simulator.
4. Enter the URL shown by the Windows computer service.

## Remaining Native Work

- APNs remote push, background refresh execution, app icon, launch branding, and App Store metadata are not yet included.
