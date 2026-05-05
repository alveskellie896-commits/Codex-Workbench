# Remodex parity for Codex Workbench

Last updated: 2026-05-02.

## Scope and decision

Codex Workbench targets Windows laptop + iPhone. Remodex targets macOS bridge + native iOS. This repo now uses a PWA-first route because the Windows bridge, trusted-device pairing, send queue, diagnostics, safe Git panel, uploads, service worker, and iPhone keyboard guardrails can reach the requested 85+ near-native threshold for daily use without requiring a Mac. The iOS project remains a reusable native-client scaffold, but it was not built on Windows and still needs Mac/Xcode validation.

Security wording is intentionally conservative: Workbench implements password auth, hashed access/refresh tokens, hashed trusted-device tokens, one-time pairing codes, revocation, audit log, and HTTPS/Tailscale/temporary tunnel transport. It does not claim Remodex's full independent relay E2E secure session.

## Key references used

- Remodex source snapshot: `C:\Users\keshi\AppData\Local\Temp\remodex-ref`.
- Remodex GitHub: https://github.com/Emanuele-web04/remodex
- OpenAI Codex CLI help: https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started
- OpenAI Codex usage/limits note: https://help.openai.com/en/articles/11369540-codex-in-chatgpt
- MDN VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API
- MDN MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- MDN FileReader readAsDataURL: https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsDataURL.
- WebKit iOS Home Screen Web Push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Apple Web Push docs: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- Tailscale Funnel docs: https://tailscale.com/docs/features/tailscale-funnel
- Tailscale Funnel CLI docs: https://tailscale.com/docs/reference/tailscale-cli/funnel
- Cloudflare Quick Tunnels docs: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- node-qrcode docs: https://github.com/soldair/node-qrcode
- Git docs: https://git-scm.com/docs/git-pull, https://git-scm.com/docs/git-checkout, https://git-scm.com/docs/git-stash

## Source-level Remodex mapping table

| Remodex capability | Remodex reference source | Codex Workbench implementation path | Windows+iPhone implementation | Status | Phone-visible | Verification | Remaining gap |
|---|---|---|---|---|---|---|---|
| Sidebar project/thread grouping, search, recent activity | `CodexMobile/CodexMobile/Views/Sidebar/SidebarThreadListView.swift`, `SidebarThreadGrouping.swift`, `SidebarSearchField.swift`, `SidebarThreadRowView.swift`, `SidebarThreadRunBadgeView.swift` | `src/client/App.jsx`, `src/client/styles.css`, `src/client/mobileRemodex.css` | PWA sidebar groups projects and threads, supports recent active sort, search, pinned/favorites preferences, status badges, parent/child subagent rows. | Real PWA implementation | Yes | `src/client/App.test.jsx`, manual mobile checklist | Native iOS list gestures and system search are not present. |
| Timeline latest-first open and long history | `CodexMobile/CodexMobile/Views/Turn/TurnTimelineView.swift`, `TurnScrollStateTracker.swift`, `TurnTimelineReducer.swift`, `TurnMessageCaches.swift` | `src/server/threadDetailWindow.js`, `src/client/App.jsx`, `src/client/messageMerge.js` | API returns latest window first; client incrementally loads older pages, uses virtual rows, preserves position when reading history, and avoids stealing scroll unless near bottom. | Real PWA implementation | Yes | `src/server/threadDetailWindow.test.js`, `src/client/messageMerge.test.js`, `src/client/mobileRemodex.test.js` | Browser DOM virtualization is less exact than SwiftUI list reuse. |
| Message merge, trace folding, tool/activity records | `CodexMobile/CodexMobile/Views/Turn/TurnTimelineRenderProjection.swift`, `CommandExecutionViews.swift`, `ThinkingDisclosureParser.swift` | `src/client/messageMerge.js`, `src/client/App.jsx`, `src/server/rolloutParser.js` | Merges rollout and app-server messages, displays user/assistant messages prominently, weakens trace/tool records. | Real PWA implementation | Yes | `src/client/messageMerge.test.js`, `src/server/rolloutParser.test.js` | Mermaid/native diff rendering remains lighter than Remodex. |
| Composer attachments and command/context completion | `ComposerBottomBar.swift`, `TurnComposerView.swift`, `FileAutocompletePanel.swift`, `SkillAutocompletePanel.swift`, `SlashCommandAutocompletePanel.swift`, `ComposerAttachmentsPreview.swift` | `src/client/App.jsx`, `src/client/composerAssist.js`, `src/client/filePreview.js` | `/` quick actions, `@` context hints, file picker, camera capture input, voice record/fallback, image/PDF/docx/audio cards. | Real PWA implementation with browser limits | Yes | `src/client/composerAssist.test.js`, `src/client/filePreview.test.js`, manual iPhone checklist | File/skill autocompletion is contextual hints, not native filesystem index. |
| iOS keyboard and safe area | `TurnComposerInputTextView.swift`, SwiftUI safe-area layout | `src/client/App.jsx`, `src/client/styles.css`, `src/client/mobileRemodex.css`, `src/client/main.jsx` | Uses `visualViewport`, `interactive-widget=resizes-content`, CSS safe-area variables, keyboard-open layout, fixed app shell, no horizontal pan. | Real PWA implementation | Yes | `src/client/mobileRemodex.test.js`, manual iPhone Safari checklist | Needs true device verification for every keyboard/IME version. |
| Trusted pairing and reconnect | `CodexService+TrustedPairPresentation.swift`, `SecureStore.swift`, `phodex-bridge/src/qr.js`, `secure-device-state.js` | `src/server/pairingStore.js`, `src/server/tokens.js`, `src/server/index.js`, `src/client/api.js`, `src/client/App.jsx`, `src/client/advancedWorkbench.jsx` | Server creates one-time expiring QR/short code; phone completes pairing; hashed trust token stored server-side; browser stores scoped trusted token; password remains recovery. | Real implementation | Yes | `src/server/pairingStore.test.js`, `src/server/tokens.test.js` | No hardware Keychain in PWA; token is in browser localStorage. |
| Secure transport/E2E relay | `phodex-bridge/src/secure-transport.js`, `relay/`, `CodexService+SecureTransport.swift` | `src/server/tokens.js`, `src/server/pairingStore.js`, `src/server/publicTunnel.js`, docs | Password + bearer token + trusted-device token + HTTPS/Tailscale/Cloudflare/localhost.run transport; explicit non-E2E disclosure. | PWA/Windows substitute | Partly | `src/server/tokens.test.js`, `docs/remodex-parity.md` | No X25519/Ed25519 independent relay session or APNs-grade device identity. |
| Connection recovery card and catch-up | `ConnectionRecoveryCard.swift`, `TurnConnectionRecoverySnapshotBuilder.swift`, `CodexService+Connection.swift`, `CodexService+Sync.swift` | `src/client/useWorkbenchSocket.js`, `src/client/App.jsx`, `src/server/index.js`, `public/sw.js` | WebSocket reconnects; foreground/pageshow triggers status/projects/thread catch-up; service worker version polling refreshes stale frontend; recovery banner explains offline/recovering state. | Real PWA implementation | Yes | `src/client/mobileRemodex.test.js`, build/test, manual checklist | Background execution stops when iOS suspends the PWA. |
| Send queue / queued drafts | `QueuedDraftsPanel.swift`, `TurnComposerCommandState.swift`, `CodexService+Messages.swift` | `src/client/sendQueue.js`, `src/client/App.jsx`, `src/server/runManager.js`, `src/client/advancedWorkbench.jsx` | Local queue has stages, finite retry policy, stale cleanup, upload progress, retry/cancel; server follow-ups support create/edit/reorder/cancel and auto drain. | Real implementation | Yes | `src/client/sendQueue.test.js`, `src/server/runManager.test.js` | Native mid-run steering is not claimed unless app-server exposes a stable API. |
| Runtime controls | `TurnComposerRuntimeState.swift`, `TurnComposerRuntimeMenuBuilder.swift`, `CodexService+RuntimeConfig.swift`, `CodexService+RuntimeCompatibility.swift` | `src/server/runtimeControls.js`, `src/server/appServerClient.js`, `src/server/runManager.js`, `src/client/advancedWorkbench.jsx` | Model/reasoning/access/Plan controls normalize and report per-send-mode support; CLI/app-server pass supported fields; desktop marks prompt fallback/unsupported. | Real with explicit fallback | Yes | `src/server/runtimeControls.test.js` | Desktop mode cannot truly pass every control into the native desktop UI. |
| Codex Desktop / CLI / app-server sync | `phodex-bridge/src/rollout-live-mirror.js`, `codex-transport.js`, `desktop-handler.js`, `CodexService+Incoming*.swift` | `src/server/appServerClient.js`, `src/server/runManager.js`, `src/server/desktopDriver.js`, `src/server/rolloutChangeDetector.js` | Supports desktop UI send, CLI resume/exec, and app-server JSON-RPC when available; confirms desktop receipt by rollout/message change; phones poll/watch hot threads. | Real implementation with mode limits | Yes | `src/server/rolloutChangeDetector.test.js`, `src/server/runtimeControls.test.js` | Desktop GUI live mirror is best-effort refresh/reopen, not a native mirror protocol. |
| Subagents | `SubagentViews.swift`, `CodexService+ThreadFork.swift`, `CodexService+ThreadForkCompatibility.swift` | `src/server/subagentStore.js`, `src/server/index.js`, `src/client/App.jsx`, `src/client/advancedWorkbench.jsx` | Shows native subagent tree when metadata exists; supports parent/child navigation; create uses explicit `/subagents` command fallback with role templates and disclosure. | Real display + command fallback | Yes | `src/server/subagentStore.test.js` | No fake native create API; creation depends on Codex runtime support. |
| Git safe actions | `GitActionsService.swift`, `TurnGitActionsToolbar.swift`, `TurnGitBranchSelector.swift`, `phodex-bridge/src/git-handler.js` | `src/server/gitService.js`, `src/server/index.js`, `src/client/advancedWorkbench.jsx` | Status/branch/files/shortstat/commits; safe actions require typed confirmation; disallows reset/clean/force/delete/rebase; temp-repo tests. | Real implementation | Yes | `src/server/gitService.test.js` | Workspace checkpoint/revert is documented as a gap unless implemented in future. |
| Workspace change summary / revert preview | `AssistantRevertSheet.swift`, `TurnDiffSheet.swift`, `TurnFileChangeSummaryParser.swift`, `workspace-checkpoints.js`, `workspace-handler.js` | `src/server/gitService.js`, `src/client/advancedWorkbench.jsx`, docs | Shows Git changed files and shortstat; safe Git operations are available after confirmation. | PWA/Windows substitute | Yes, lighter | `src/server/gitService.test.js`, manual Git checklist | No checkpoint-backed revert/apply preview yet. |
| Uploads, camera, PDF/docx, voice | `TurnAttachmentPipeline.swift`, `CameraImagePicker.swift`, `VoiceRecordingCapsule.swift`, `GPTVoiceTranscriptionManager.swift`, `voice-handler.js` | `src/server/uploads.js`, `src/client/App.jsx`, `src/client/uploadHistory.js`, `src/client/filePreview.js`, `src/client/advancedWorkbench.jsx` | Thread-scoped upload folders; image/PDF/docx/audio cards; camera `capture`; MediaRecorder with explicit iPhone fallback; upload progress and retry. | Real PWA implementation with browser limits | Yes | `src/server/uploads.test.js`, `src/client/uploadHistory.test.js`, `src/client/filePreview.test.js` | No native iOS photo picker/voice transcription pipeline. |
| Notifications and completion awareness | `CodexService+Notifications.swift`, `notifications-handler.js`, `push-notification-*` | `src/client/App.jsx`, `public/sw.js`, `src/client/useWorkbenchSocket.js` | In-app reminder center, title/notification API, service-worker notification click, foreground refresh, offline banners; Web Push is not claimed without subscription server. | PWA substitute | Yes | Manual checklist, `public/sw.js` review | No APNs/native background push; iOS Web Push needs Home Screen install and server setup. |
| Service status/diagnostics | `daemon-state.js`, `package-version-status.js`, `bridge.js` | `src/server/systemDiagnostics.js`, `src/server/index.js`, `src/server/publicTunnel.js`, `scripts/start-codex-workbench.ps1` | `/api/system/status` and `/api/system/diagnostics` include bridge state, checks, public link metadata, PWA version, token/trusted-device diagnostics. | Real implementation | Yes | `src/server/systemDiagnostics.test.js`, HTTP checklist | Deep app-server probe can time out if Codex Desktop is closed. |
| Windows autostart replacement for launchd | `phodex-bridge/src/macos-launch-agent.js` | `scripts/start-codex-workbench.ps1`, `scripts/install-autostart.ps1`, `scripts/uninstall-autostart.ps1` | Task Scheduler autostart, duplicate process/port guard, restart loop, logs, no system security changes. | Real Windows implementation | Computer-visible, status visible on phone | Manual Windows checklist | Not a Windows service wrapper; runs as user scheduled task. |
| Account/rate/context status | `account-status.js`, `ContextWindowProgressRing.swift`, `CodexService+Account.swift` | `src/server/index.js`, `src/client/App.jsx`, docs | Model/send mode/active run/status shown; account/rate/context are documented as limited unless Codex exposes stable local API. | Partial substitute | Partly | Manual diagnostics checklist | No reliable local account/rate/context-window API in this bridge. |
| iOS native shell | `CodexMobile/CodexMobile/*` | `ios/CodexWorkbench/*` | Existing SwiftUI scaffold has host config, auth/service/WebSocket/project/thread/chat/composer/settings models and README route; Windows cannot build Xcode. | Source-level route only | No, unless built on Mac | `ios/CodexWorkbench/README.md`, manual Mac checklist | Needs Mac/Xcode, signing, real device, notification entitlement, and API hardening. |

## Near-native experience score

| Dimension | Score | Evidence |
|---|---:|---|
| First pairing and trusted reconnect | 9/10 | Standard QR SVG via `qrcode`, short code, one-time expiry, hashed trust token, device management, revoke disconnect. |
| iPhone Home Screen app feel | 9/10 | Manifest, icon, standalone display, safe area, PWA cache/version handling, app-like shell. |
| Session list and project navigation | 9/10 | Search, recent order, status badges, pinned preferences, subagent relation display. |
| Chat page and long history | 9/10 | Latest-window default, older pagination, virtual rows, scroll preservation. |
| Composer and iOS keyboard | 13/15 | VisualViewport, keyboard-open CSS, attachments, camera, voice fallback, send/stop, 44px controls. Needs real-device IME sweep. |
| Runtime controls and queue | 9/10 | Capability matrix, CLI/app-server args, desktop fallback, queue edit/reorder/cancel/auto drain. |
| Files/camera/voice | 8/10 | Cards/progress/thread scope/capture/MediaRecorder fallback. No native voice transcription. |
| Notifications and background recovery | 6/8 | In-app center, optional browser notification, title/foreground catch-up. No APNs/Web Push server. |
| Windows bridge stability | 9/10 | Status/diagnostics, public-link metadata, autostart guard/restart, tunnel recovery. |
| Advanced capabilities | 6/7 | Subagents/Git/runtime/send modes are visible and honest. Workspace checkpoint/revert gap remains. |
| Total | 87/100 | Meets the 85-point threshold for PWA-first delivery, with no intentional claim of full native/APNs/E2E parity. |

### P0 gate review

- iPhone input box: mitigated by `visualViewport`, safe-area CSS, keyboard-open layout, and mobile CSS tests.
- Phone sends disappearing: mitigated by local queue, optimistic local messages, status stages, finite retry, stale cleanup.
- Infinite retry / old spinner: finite retry by error class and stale recovery; terminal run state resolves old queues.
- Latest message default: initial thread detail loads latest window and scrolls bottom.
- Pairing fake UI: server-backed one-time pairing and trusted-device verification.
- Advanced isolation: Advanced panel remains available but login, trusted reconnect, diagnostics, files, queue state, composer controls are integrated into the main path.
- `npm test` / `npm run build`: must pass before release.
- Remodex tables: this file is the capability and source-level mapping table.
- Unsupported claims: no claims of APNs, native background, full E2E relay, or perfect desktop live mirror.

## PWA/iOS route decision

PWA is the primary delivery because it now reaches 87/100 on the scoring gate and satisfies the daily Windows+iPhone paths: open icon/stable URL, trusted login, project/thread list, latest messages, send/queue/retry, attachments, diagnostics, Git, runtime controls, and Subagents fallback.

The `ios/CodexWorkbench` source remains a continuation route. It should be promoted only if the user needs true native keyboard behavior, APNs/background notifications, Keychain-only device tokens, or native file/voice/photo pipelines. Remaining native steps: open on Mac, update bundle/team, point HostConfig to the Windows bridge, run unit tests, verify WebSocket and pairing on a real iPhone, add push entitlement/server if APNs/Web Push replacement is required.

## Manual mobile acceptance checklist

1. Add the PWA to iPhone Home Screen and open from the icon.
2. Pair with QR: Advanced → Pairing → Create pairing code, scan from iPhone, verify trusted login works after closing/reopening.
3. Revoke the phone from device management and verify HTTP/WS access fails with the revoke message.
4. Open a long thread: newest messages appear first; pull/scroll upward loads older records; streaming/refresh does not pull you down when reading history.
5. Focus composer with Chinese IME in portrait and landscape; composer remains visible and bottom blank area stays small.
6. Send while a run is busy; verify local queued state, edit/reorder/cancel, then auto-send after completion or manual retry.
7. Upload image, PDF, docx, camera photo, and voice/audio file; verify cards/progress stay scoped to the current thread.
8. Toggle runtime controls; verify desktop mode marks unsupported controls and CLI/app-server mode passes supported options.
9. Use Git status in a temp repo; try commit/pull/push only after typed confirmation; verify dangerous actions are unavailable.
10. Turn Wi-Fi/cellular off and back on; verify recovery banner, WebSocket reconnect, status catch-up, and no stale spinner.

## User impact of remaining gaps

- No APNs/native background: if the PWA is suspended, completion is visible when reopened or when foreground notification APIs are allowed; it is not a guaranteed native push.
- No full Remodex E2E relay: use Tailscale/Funnel HTTPS plus password/trusted-device protection; do not share the public URL broadly.
- No workspace checkpoint/revert engine: Git status and safe actions are present, but checkpointed revert preview still needs a dedicated implementation.
- No native iOS build verification on Windows: SwiftUI source is present as a route, but real App Store/TestFlight-quality delivery needs Mac/Xcode/signing/device tests.
