// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectList, cleanThreadTitle } from "./App.jsx";
import fs from "node:fs";

function renderProjectList(root, projects, overrides = {}) {
  return root.render(
    <ProjectList
      projects={projects}
      selectedCwd=""
      selectedThreadId={null}
      activeThreadId={null}
      activeRunState={null}
      pendingReplies={{}}
      drafts={{}}
      connection="online"
      status={{}}
      trustedDevice={null}
      onOpenDiagnostics={vi.fn()}
      onNewChat={vi.fn()}
      onNewChatForProject={vi.fn()}
      onQuickStart={vi.fn()}
      onSelectProject={vi.fn()}
      onSelectThread={vi.fn()}
      {...overrides}
    />
  );
}

function projectWithThreads(threads) {
  return [
    {
      cwd: "/workspace/demo",
      label: "demo",
      recentThreads: threads.map((thread) => ({
        cwd: "/workspace/demo",
        updatedAt: "2026-04-27T03:00:00.000Z",
        subagents: [],
        ...thread
      }))
    }
  ];
}

describe("ProjectList", () => {
  let container;
  let root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    localStorage.clear();
  });

  test("keeps hook order stable when projects load after the empty state", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderProjectList(root, []);
    });

    await act(async () => {
      renderProjectList(root, projectWithThreads([{ id: "thread-1", title: "Test thread" }]));
    });

    expect(container.textContent).toContain("Test thread");
    expect(container.textContent).not.toContain("/workspace/demo");
  });

  test("shows thread completion and running status in the sidebar", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderProjectList(
        root,
        projectWithThreads([
          { id: "thread-running", title: "Running task", status: "running" },
          { id: "thread-complete", title: "Completed task", status: "complete" },
          { id: "thread-failed", title: "Failed task", status: "failed" },
          { id: "thread-incomplete", title: "Incomplete task", status: "incomplete" }
        ])
      );
    });

    expect(container.textContent).toContain("正在回复");
    expect(container.textContent).toContain("失败");
    expect(container.textContent).not.toContain("未完成");
    expect(container.querySelector(".desktop-thread-row.status-complete")).toBeTruthy();
    expect(container.querySelector(".desktop-thread-row.status-idle")).toBeTruthy();
  });

  test("renders each chat once in a lightweight history list", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderProjectList(root, projectWithThreads([{ id: "thread-1", title: "Single thread" }]));
    });

    expect(container.textContent).toContain("历史记录");
    expect(container.textContent).not.toContain("继续聊天");
    expect(container.textContent).not.toContain("进行中");
    expect(container.querySelectorAll(".desktop-thread-row")).toHaveLength(1);
    expect(container.querySelector(".thread-date-group")).toBeTruthy();
    expect(container.querySelector(".project-archive-toggle")).toBeTruthy();
  });

  test("keeps active and failed work as subtle row status instead of dashboard sections", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderProjectList(
        root,
        projectWithThreads([
          { id: "thread-running", title: "Running task", status: "running" },
          { id: "thread-failed", title: "Failed task", status: "failed" },
          { id: "thread-complete", title: "Completed task", status: "complete" }
        ])
      );
    });

    expect(container.textContent).not.toContain("继续聊天");
    expect(container.textContent).not.toContain("进行中");
    expect(container.querySelector(".spotlight-thread-row")).toBeNull();
    expect(container.querySelector(".attention-thread-row")).toBeNull();
    expect(container.querySelectorAll(".desktop-thread-row")).toHaveLength(3);
    expect(container.querySelector(".desktop-thread-row.status-running")).toBeTruthy();
    expect(container.querySelector(".desktop-thread-row.status-failed")).toBeTruthy();
    expect(container.querySelector(".thread-spinner")).toBeTruthy();
    expect(container.querySelector(".thread-status-dot.failed")).toBeTruthy();
    expect(container.querySelector(".meta-pill")).toBeNull();
  });

  test("renders the chatgpt-style sidebar shell with new-chat, search, and history", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onNewChat = vi.fn();

    await act(async () => {
      renderProjectList(root, projectWithThreads([{ id: "thread-1", title: "Single thread" }]), { onNewChat, onOpenDiagnostics: vi.fn() });
    });

    expect(container.querySelector(".remodex-sidebar-header")).toBeTruthy();
    expect(container.querySelector(".sidebar-menu")).toBeTruthy();
    expect(container.querySelector(".sidebar-menu-panel")).toBeTruthy();
    expect(container.querySelector(".project-health-strip")).toBeNull();
    expect(container.textContent).toContain("聊天");
    expect(container.textContent).not.toContain("Workbench");
    expect(container.textContent).not.toContain("Windows");
    expect(container.textContent).not.toContain("桥接");
    expect(container.textContent).not.toContain("运行记录");
    expect(container.textContent).not.toContain("在线");
    expect(container.querySelector(".remodex-sidebar-footer")).toBeNull();
    expect(container.querySelector(".home-prompt-card")).toBeNull();
    expect(container.querySelector(".thread-filter-tabs")).toBeNull();
    expect(container.querySelector(".quick-template-row")).toBeNull();
    expect(container.querySelector(".spotlight-section")).toBeNull();
    expect(container.querySelector(".attention-section")).toBeNull();
    expect(container.querySelector(".primary-search input")?.getAttribute("placeholder")).toBe("搜索");
    expect(container.querySelector(".primary-search kbd")?.textContent).toBe("Ctrl K");
    expect(container.querySelector(".recent-section")).toBeTruthy();
    expect(container.querySelector(".quick-remote-strip")).toBeNull();
    const newChatButton = container.querySelector(".remodex-new-chat");
    expect(newChatButton?.disabled).toBe(false);
    expect(newChatButton?.textContent).toContain("新聊天");

    await act(async () => {
      newChatButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  test("searches the flat chat history without showing dashboard filters", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderProjectList(
        root,
        projectWithThreads([
          { id: "thread-1", title: "Needle chat" },
          { id: "thread-2", title: "Other chat" }
        ])
      );
    });

    const input = container.querySelector(".primary-search input");
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeValueSetter.call(input, "Needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("搜索结果");
    expect(container.textContent).toContain("Needle chat");
    expect(container.textContent).not.toContain("Other chat");
    expect(container.querySelector(".thread-filter-tabs")).toBeNull();
  });

  test("keeps normal history rows title-first without project-path subtitles or always-on actions", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      renderProjectList(root, projectWithThreads([{ id: "thread-1", title: "Clean row" }]));
    });

    const row = container.querySelector(".recent-section .desktop-thread-row");
    expect(row).toBeTruthy();
    expect(row?.querySelector(".thread-row-main strong")?.textContent).toBe("Clean row");
    expect(row?.querySelector(".thread-row-main small")).toBeNull();
    expect(row?.querySelector(".thread-list-meta")).toBeNull();
    expect(row?.querySelector(".meta-pill")).toBeNull();
    expect(container.textContent).not.toContain("/workspace");
  });

  test("keeps pinned chats in a lightweight pinned section without duplicating history rows", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    localStorage.setItem(
      "codex-workbench-thread-preferences",
      JSON.stringify({
        pinned: {
          "thread-pinned": "2026-04-27T04:00:00.000Z"
        }
      })
    );

    await act(async () => {
      renderProjectList(
        root,
        projectWithThreads([
          { id: "thread-pinned", title: "Pinned chat" },
          { id: "thread-normal", title: "Normal chat" }
        ])
      );
    });

    expect(container.querySelector(".pinned-section")).toBeTruthy();
    expect(container.querySelector(".thread-filter-tabs")).toBeNull();
    expect(container.textContent).toContain("Pinned chat");
    expect(container.textContent).toContain("Normal chat");
    expect(container.querySelectorAll(".pinned-section .desktop-thread-row")).toHaveLength(1);
    expect(container.querySelectorAll(".recent-section .desktop-thread-row")).toHaveLength(1);
    expect(container.textContent).not.toContain("任务概览");
  });

  test("offers lightweight project scoped new chat actions", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onNewChatForProject = vi.fn();

    await act(async () => {
      renderProjectList(root, projectWithThreads([{ id: "thread-1", title: "Single thread" }]), { onNewChatForProject });
    });

    const archiveToggle = container.querySelector(".project-archive-toggle");
    expect(archiveToggle).toBeTruthy();

    await act(async () => {
      archiveToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const projectButton = container.querySelector(".project-new-chat-button");
    expect(projectButton).toBeTruthy();

    await act(async () => {
      projectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNewChatForProject).toHaveBeenCalledTimes(1);
    expect(onNewChatForProject.mock.calls[0][0]?.cwd).toBe("/workspace/demo");
  });

  test("cleans noisy prompt-derived thread titles for the mobile list", () => {
    expect(cleanThreadTitle("以下是来自 prompt 文件 `C:\\Users\\keshi\\Desktop\\任务.md` 的任务指令。任务名称：Remodex 原生体验改造。")).toBe("Remodex 原生体验改造");
    expect(cleanThreadTitle("# Files mentioned by the user:\n\n## demo.png\n\n## My request for Codex:\n修复手机输入框")).toBe("修复手机输入框");
    expect(cleanThreadTitle("AutoResearch 长任务 请直接执行下面的实际任务内容： --- #")).toBe("AutoResearch 长任务");
    expect(cleanThreadTitle("AutoResearch长任务请直接执行下面的实际任务内容： --- #")).toBe("AutoResearch 长任务");
    expect(cleanThreadTitle("以下是来自 prompt 文件 `C:\\任务.md` 的任务指令。AutoResearch 后台任务已经创建成功；不要再启动 AutoResearch、codex-autoresearch 或创建子任务，请直接执行下面的实际任务内容：\n\n---\n\n# AutoResearch 长任务\n\n## 任务名称\n把 Codex-Workbench 一步到位改造成 Remodex 级别的 Windows 笔记本 + iPhone 远程 Codex 产品。\n\n## 工作目录\nC:\\demo")).toBe("把 Codex-Workbench 一步到位改造成 Remodex 级别的 Windows 笔记本 + iPhone 远程 Codex 产品");
    expect(cleanThreadTitle("神经科学与自我提升研究文档三轮深度优化 工作目录： C:\\Users\\keshi\\Desktop 目标文件： - C:\\Users\\keshi\\Desktop\\研究.md")).toBe("神经科学与自我提升研究文档三轮深度优化");
  });

  test("sanitizes noisy stored aliases before rendering the sidebar", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.setItem(
      "codex-workbench-thread-preferences",
      JSON.stringify({
        aliases: {
          "thread-1": "神经科学与自我提升研究文档三轮深度优化 工作目录： C:\\Users\\keshi\\Desktop 目标文件： - C:\\Users\\keshi\\Desktop\\研究.md"
        }
      })
    );

    await act(async () => {
      renderProjectList(root, projectWithThreads([{ id: "thread-1", title: "Fallback title" }]));
    });

    expect(container.textContent).toContain("神经科学与自我提升研究文档三轮深度优化");
    expect(container.textContent).not.toContain("工作目录");
  });
});

describe("polish guardrails", () => {
  test("keeps public app chrome in chat language", () => {
    const indexHtml = fs.readFileSync("index.html", "utf8");
    const manifest = fs.readFileSync("public/manifest.webmanifest", "utf8");

    expect(indexHtml).toContain("<title>聊天</title>");
    expect(indexHtml).toContain('content="聊天"');
    expect(manifest).toContain('"short_name": "聊天"');
    expect(indexHtml).not.toContain("CODEX WORKBENCH");
    expect(manifest).not.toContain("Workbench");
  });

  test("keeps the default CSS away from unstable mobile typography tricks", () => {
    const baseCss = fs.readFileSync("src/client/styles.css", "utf8");
    const mobileCss = fs.readFileSync("src/client/mobileRemodex.css", "utf8");

    expect(baseCss).not.toMatch(/font-size:\s*clamp\([^;]*vw/);
    expect(mobileCss).not.toMatch(/font-size:\s*clamp\([^;]*vw/);
    expect(baseCss).not.toMatch(/letter-spacing:\s*-/);
    expect(mobileCss).not.toMatch(/letter-spacing:\s*-/);
  });

  test("does not fight the reader while a long chat is streaming", () => {
    const appSource = fs.readFileSync("src/client/App.jsx", "utf8");
    const threadDetailSource = appSource.slice(appSource.indexOf("function ThreadDetail("), appSource.indexOf("function ThreadCommandHeader("));

    expect(threadDetailSource).not.toContain("[40, 120, 260, 520, 900, 1400]");
    expect(threadDetailSource).not.toContain("until: Date.now() + 5000");
    expect(threadDetailSource).toContain("activeMessageRowsSignature");
    expect(threadDetailSource).toContain("userScrollHoldUntilRef");
    expect(threadDetailSource).toContain("scheduleScrollStateUpdate");
    expect(threadDetailSource).toContain("requestAnimationFrame");
    expect(threadDetailSource).toContain("setIsNearBottom((current)");
    expect(threadDetailSource).toContain("setHasNewActivity((current)");
    expect(threadDetailSource).toContain("hasNewActivity ? ");
  });

  test("keeps virtualized messages cheap to measure during streaming updates", () => {
    const appSource = fs.readFileSync("src/client/App.jsx", "utf8");
    const virtualRowsSource = appSource.slice(appSource.indexOf("function useVirtualRows("), appSource.indexOf("function filterThreadBranchForQuery("));

    expect(appSource).toContain("const VIRTUAL_MESSAGE_HEIGHT_DELTA = 3");
    expect(virtualRowsSource).toContain("heightFrameRef");
    expect(virtualRowsSource).toContain("scheduleHeightVersion");
    expect(virtualRowsSource).toContain("requestAnimationFrame");
    expect(virtualRowsSource).toContain("Math.abs(previous - nextHeight) <= VIRTUAL_MESSAGE_HEIGHT_DELTA");
    expect(virtualRowsSource).not.toContain("setHeightVersion((current) => current + 1);\n    },");
  });

  test("lets the browser keep a stable scroll anchor inside chat history", () => {
    const baseCss = fs.readFileSync("src/client/styles.css", "utf8");
    const messagesCss = baseCss.slice(baseCss.indexOf(".messages {"), baseCss.indexOf(".virtual-message-list {"));
    const messageCss = baseCss.slice(baseCss.indexOf(".message {"), baseCss.indexOf(".message.user {"));

    expect(messagesCss).toContain("overflow-anchor: auto");
    expect(messageCss).toContain("overflow-anchor: auto");
    expect(baseCss).toContain(".jump-latest-button");
    expect(baseCss).toContain(".messages-end");
    expect(baseCss).toContain("overflow-anchor: none");
  });

  test("self-recovers from stale mobile builds without blocking the page", () => {
    const appSource = fs.readFileSync("src/client/App.jsx", "utf8");
    const buildCheckSource = appSource.slice(appSource.indexOf("const clearPwaShellCaches"), appSource.indexOf("const handleVisibility"));

    expect(buildCheckSource).toContain("CLEAR_OLD_CACHES");
    expect(buildCheckSource).toContain("window.caches.keys");
    expect(buildCheckSource).toContain("freshUrl.searchParams.set(\"fresh\"");
    expect(buildCheckSource).toContain("window.location.replace");
    expect(buildCheckSource).toContain("attempts >= 2");
    expect(buildCheckSource).not.toContain("电脑端服务需要重启");
    expect(buildCheckSource).not.toContain("showInAppNotice");
  });

  test("serves app shells and assets with strict freshness headers", () => {
    const serverSource = fs.readFileSync("src/server/index.js", "utf8");
    const staticSource = serverSource.slice(serverSource.indexOf("async function serveStatic"), serverSource.indexOf("function contentType"));

    expect(staticSource).toContain("cacheControlForStatic");
    expect(staticSource).toContain("X-Codex-Build-Id");
    expect(staticSource).toContain("no-store, no-cache, must-revalidate, max-age=0");
    expect(staticSource).toContain("assets");
    expect(staticSource).toContain("sw.js");
  });

  test("keeps a stable mobile API contract for the future iOS app", () => {
    const serverSource = fs.readFileSync("src/server/index.js", "utf8");
    const apiSource = fs.readFileSync("src/client/api.js", "utf8");
    const contractDoc = fs.readFileSync("docs/mobile-api-v1.md", "utf8");
    const bootstrapSource = serverSource.slice(serverSource.indexOf("async function mobileBootstrapPayload"), serverSource.indexOf("function readBody"));

    expect(serverSource).toContain("const MOBILE_API_VERSION = 1");
    expect(serverSource).toContain('pathname === "/api/mobile/v1/bootstrap"');
    expect(serverSource).toContain('pathname === "/api/mobile/bootstrap"');
    expect(bootstrapSource).toContain('platformTarget: "ios-native-and-web"');
    expect(bootstrapSource).toContain('bootstrap: "/api/mobile/v1/bootstrap"');
    expect(bootstrapSource).toContain("requestWebSocketUrl(req)");
    expect(bootstrapSource).toContain("localSendQueueRecommended: true");
    expect(bootstrapSource).toContain("nativePush: false");
    expect(bootstrapSource).toContain("MOBILE_UPLOAD_LIMITS");
    expect(bootstrapSource).toContain("runtimePublicPayload");
    expect(bootstrapSource).toContain("modelPayload");
    expect(apiSource).toContain("mobileBootstrap()");
    expect(apiSource).toContain("/api/mobile/v1/bootstrap");
    expect(contractDoc).toContain("GET /api/mobile/v1/bootstrap");
    expect(contractDoc).toContain("The iOS app should store access/refresh tokens and trusted-device tokens in Keychain.");
  });

  test("keeps the native iOS scaffold wired to the real mobile API", () => {
    const appStateSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/App/AppState.swift", "utf8");
    const apiClientSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Services/APIClient.swift", "utf8");
    const tokenStoreSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Services/TokenStore.swift", "utf8");
    const deviceIdentitySource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Services/DeviceIdentity.swift", "utf8");
    const notificationSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Services/NotificationService.swift", "utf8");
    const appEntrySource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/App/CodexWorkbenchApp.swift", "utf8");
    const xcodeProject = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench.xcodeproj/project.pbxproj", "utf8");
    const authSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Models/AuthModels.swift", "utf8");
    const messageSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Models/MessageModels.swift", "utf8");
    const projectSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Models/ProjectModels.swift", "utf8");
    const runtimeTestsSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbenchTests/RuntimeControlsTests.swift", "utf8");
    const webSocketSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Services/WebSocketClient.swift", "utf8");
    const chatSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Views/Chat/ChatView.swift", "utf8");
    const messageListSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Views/Chat/MessageListView.swift", "utf8");
    const composerSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Views/Chat/ComposerView.swift", "utf8");
    const threadListSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Views/Projects/ThreadListView.swift", "utf8");
    const authViewSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Views/Auth/AuthenticationView.swift", "utf8");
    const settingsSource = fs.readFileSync("ios/CodexWorkbench/CodexWorkbench/Views/Settings/SettingsView.swift", "utf8");
    const readme = fs.readFileSync("ios/CodexWorkbench/README.md", "utf8");
    const publicCopy = [authViewSource, settingsSource, readme].join("\n");

    expect(appStateSource).toContain("let tokenStore = KeychainTokenStore()");
    expect(appStateSource).toContain("func refreshBootstrap() async");
    expect(appStateSource).toContain("var trustedDevice: TrustedDeviceCredential?");
    expect(appStateSource).toContain("tokenStore.loadTrustedDevice()");
    expect(appStateSource).toContain("func updateTrustedDevice");
    expect(appStateSource).toContain("func forgetTrustedDevice");
    expect(appStateSource).toContain("let notificationService: NotificationService");
    expect(appStateSource).toContain("var notificationsEnabled");
    expect(appStateSource).toContain("func refreshNotificationStatus() async");
    expect(appStateSource).toContain("func setNotificationsEnabled");
    expect(appStateSource).toContain("func foregroundRefresh() async");
    expect(appEntrySource).toContain("@Environment(\\.scenePhase)");
    expect(appEntrySource).toContain("await appState.foregroundRefresh()");
    expect(apiClientSource).toContain("func mobileBootstrap() async throws -> MobileBootstrap");
    expect(apiClientSource).toContain('path: "/api/mobile/v1/bootstrap"');
    expect(apiClientSource).toContain("includeAuthIfAvailable: true");
    expect(apiClientSource).toContain("func deviceLogin(credential: TrustedDeviceCredential");
    expect(apiClientSource).toContain('path: "/api/auth/device-login"');
    expect(apiClientSource).toContain("func completePairing(code: String");
    expect(apiClientSource).toContain('path: "/api/pairing/complete"');
    expect(apiClientSource).toContain("func fetchTrustedDevices()");
    expect(apiClientSource).toContain('path: "/api/devices"');
    expect(apiClientSource).toContain("func renameTrustedDevice");
    expect(apiClientSource).toContain("func revokeTrustedDevice");
    expect(apiClientSource).toContain("func createThread(projectID: String? = nil)");
    expect(apiClientSource).toContain('path: "/api/threads/new"');
    expect(apiClientSource).toContain("func fetchFollowUps(threadID: String)");
    expect(apiClientSource).toContain("func runtimeDefaults() async throws -> RuntimeInfo");
    expect(apiClientSource).toContain("func setRuntimeDefaults(_ controls: RuntimeControls)");
    expect(apiClientSource).toContain("func threadRuntime(threadID: String) async throws -> RuntimeInfo");
    expect(apiClientSource).toContain("func setThreadRuntime(threadID: String, controls: RuntimeControls)");
    expect(apiClientSource).toContain('path: "/api/runtime/defaults"');
    expect(apiClientSource).toContain('/runtime"');
    expect(apiClientSource).toContain("func openDesktopThread(threadID: String)");
    expect(apiClientSource).toContain('/open-desktop"');
    expect(apiClientSource).toContain("func enqueueFollowUp(threadID: String, message: String, runtime: RuntimeControls? = nil)");
    expect(apiClientSource).toContain("func cancelFollowUp(threadID: String, followUpID: String)");
    expect(apiClientSource).toContain('/followups"');
    expect(apiClientSource).toContain("func fetchThreadDetail(");
    expect(apiClientSource).toContain('/detail", queryItems: queryItems');
    expect(apiClientSource).toContain("try await model().options");
    expect(apiClientSource).toContain("func uploadAttachment(");
    expect(apiClientSource).toContain("threadID: String");
    expect(apiClientSource).toContain("attachments: [UploadedFile] = []");
    expect(apiClientSource).toContain("threadId: threadID");
    expect(authSource).toContain("struct MobileBootstrap");
    expect(authSource).toContain("struct TrustedDeviceCredential");
    expect(authSource).toContain("struct PairingCompleteResponse");
    expect(authSource).toContain("struct DeviceLoginRequest");
    expect(authSource).toContain("struct DeviceMutationRequest");
    expect(authSource).toContain("var deviceId: String?");
    expect(tokenStoreSource).toContain("func loadTrustedDevice()");
    expect(tokenStoreSource).toContain("func saveTrustedDevice");
    expect(tokenStoreSource).toContain('private let trustedDeviceAccount = "trusted-device"');
    expect(deviceIdentitySource).toContain("UIDevice.current.identifierForVendor");
    expect(notificationSource).toContain("import UserNotifications");
    expect(notificationSource).toContain("UNUserNotificationCenterDelegate");
    expect(notificationSource).toContain("requestAuthorization(options: [.alert, .sound, .badge])");
    expect(notificationSource).toContain("notifyThreadCompleted");
    expect(notificationSource).toContain("notifyThreadFailed");
    expect(xcodeProject).toContain("DeviceIdentity.swift in Sources");
    expect(xcodeProject).toContain("NotificationService.swift in Sources");
    expect(xcodeProject).toContain("RuntimeControlsTests.swift in Sources");
    expect(messageSource).toContain("var queueIfRunning: Bool");
    expect(messageSource).toContain("var runtime: RuntimeControls?");
    expect(messageSource).toContain("enum SendQueueStage");
    expect(messageSource).toContain("struct SendQueueItem");
    expect(messageSource).toContain("struct FollowUpRequest");
    expect(messageSource).toContain("struct FollowUpResponse");
    expect(messageSource).toContain('case followUpQueued = "follow_up_queued"');
    expect(messageSource).toContain("var threadId: String?");
    expect(messageSource).toContain("struct PendingAttachment");
    expect(messageSource).toContain("case uploading");
    expect(messageSource).toContain("case failed");
    expect(messageSource).toContain("decodeIfPresent([String].self, forKey: .attachmentIDs)");
    expect(messageSource).toContain('case followUpQueued = "followup.queued"');
    expect(messageSource).toContain('case securityDeviceRevoked = "security.device-revoked"');
    expect(projectSource).toContain("static func fromSocketPayload");
    expect(projectSource).toContain("struct CreateThreadRequest");
    expect(projectSource).toContain("struct CreateThreadResponse");
    expect(projectSource).toContain("struct DesktopOpenResponse");
    expect(projectSource).toContain("struct RuntimeControls");
    expect(projectSource).toContain("struct RuntimeInfo");
    expect(projectSource).toContain("struct RuntimeCapabilities");
    expect(projectSource).toContain("struct RuntimeControlsRequest");
    expect(projectSource).toContain("var reasoningEffort: String");
    expect(projectSource).toContain("var accessMode: String");
    expect(projectSource).toContain("var planMode: Bool");
    expect(projectSource).toContain("try? decodeIfPresent(Bool.self");
    expect(runtimeTestsSource).toContain("testRuntimeControlsDecodeStringBooleansAndNormalizeInvalidValues");
    expect(runtimeTestsSource).toContain("testRuntimeInfoUsesThreadControlsWhenPresent");
    expect(runtimeTestsSource).toContain("testSendAndFollowUpRequestsEncodeRuntimeControls");
    expect(runtimeTestsSource).toContain("SendMessageRequest(message: \"hello\", runtime: controls)");
    expect(webSocketSource).toContain("func eventsWithReconnect(");
    expect(chatSource).toContain("listenForRealtimeEvents()");
    expect(chatSource).toContain("handleRealtimeEvent");
    expect(chatSource).toContain("RealtimePill");
    expect(chatSource).toContain("@Environment(\\.scenePhase)");
    expect(chatSource).toContain("shouldNotifyRunCompletion");
    expect(chatSource).toContain("notifyIfNeeded");
    expect(chatSource).toContain("notifyThreadCompleted");
    expect(chatSource).toContain("notifyThreadFailed");
    expect(chatSource).toContain("@State private var sendQueue: [SendQueueItem] = []");
    expect(chatSource).toContain("@State private var isProcessingSendQueue = false");
    expect(chatSource).toContain("@State private var runtimeControls = RuntimeControls()");
    expect(chatSource).toContain("@State private var isRuntimeSheetPresented = false");
    expect(chatSource).toContain("@State private var isOpeningDesktop = false");
    expect(chatSource).toContain("RuntimeControlsSheet");
    expect(chatSource).toContain("saveRuntimeControls");
    expect(chatSource).toContain("threadRuntime(threadID: thread.id)");
    expect(chatSource).toContain("setThreadRuntime(threadID: thread.id, controls: controls)");
    expect(chatSource).toContain("Button(\"Open on Computer\", systemImage: \"rectangle.connected.to.line.below\")");
    expect(chatSource).toContain("openOnComputer()");
    expect(chatSource).toContain("appState.apiClient.openDesktopThread(threadID: thread.id)");
    expect(chatSource).toContain("SendQueueStrip");
    expect(chatSource).toContain("processSendQueue()");
    expect(chatSource).toContain("processQueueItemOnNetwork");
    expect(chatSource).toContain("enqueueFollowUp(");
    expect(chatSource).toContain("threadID: thread.id");
    expect(chatSource).toContain("runtime: snapshot.runtime");
    expect(chatSource).toContain("retryQueueItem");
    expect(chatSource).toContain("dismissQueueItem");
    expect(chatSource).toContain("reconcileFollowUpQueued");
    expect(chatSource).toContain("@State private var attachments: [PendingAttachment] = []");
    expect(chatSource).toContain("makePendingAttachment(from url: URL)");
    expect(chatSource).toContain("uploadAttachments(for item: SendQueueItem)");
    expect(chatSource).toContain("appState.apiClient.uploadAttachment");
    expect(chatSource).toContain("attachments: uploadedFiles");
    expect(chatSource).not.toContain("attachmentIDs: []");
    expect(messageListSource).toContain("ScrollViewReader");
    expect(messageListSource).toContain("ScrollView {");
    expect(messageListSource).toContain("LazyVStack(spacing: 12)");
    expect(messageListSource).toContain("@State private var isPinnedToBottom = true");
    expect(messageListSource).toContain("@State private var showJumpToLatest = false");
    expect(messageListSource).toContain("BottomSentinel");
    expect(messageListSource).toContain("BottomEdgePreferenceKey");
    expect(messageListSource).toContain('Label("Latest", systemImage: "arrow.down")');
    expect(messageListSource).toContain("latestMessageFingerprint");
    expect(messageListSource).toContain("followLatestIfNeeded(proxy: proxy)");
    expect(messageListSource).toContain("showJumpToLatest = true");
    expect(messageListSource).not.toContain("List(messages)");
    expect(composerSource).toContain(".fileImporter");
    expect(composerSource).toContain("allowedContentTypes: [.item]");
    expect(composerSource).toContain("PendingAttachmentCard");
    expect(composerSource).toContain("Retry upload");
    expect(threadListSource).toContain("Button(\"New Chat\", systemImage: \"square.and.pencil\"");
    expect(threadListSource).toContain("private func createThread()");
    expect(threadListSource).toContain("appState.apiClient.createThread(projectID: project.id)");
    expect(threadListSource).toContain("selection = thread");
    expect(threadListSource).toContain("insertOrMoveToFront");
    expect(threadListSource).toContain("CreatingThreadRow");
    expect(threadListSource).toContain("hasThreads: threads.isEmpty == false");
    expect(threadListSource).toContain("@State private var searchText = \"\"");
    expect(threadListSource).toContain(".searchable(text: $searchText");
    expect(threadListSource).toContain("Search conversations");
    expect(threadListSource).toContain("ThreadSearchEmptyRow");
    expect(threadListSource).toContain("func matching(_ query: String) -> [ThreadSummary]");
    expect(threadListSource).toContain("tokens.allSatisfy");
    expect(readme).toContain("WebSocketClient");
    expect(readme).toContain("integrated into `ChatView`");
    expect(readme).toContain("Native Files picker");
    expect(readme).toContain("thread-scoped uploads");
    expect(readme).toContain("Trusted iPhone pairing");
    expect(readme).toContain("trusted-device login");
    expect(readme).toContain("Native local notifications");
    expect(readme).toContain("foreground catch-up refresh");
    expect(readme).toContain("APNs remote push");
    expect(readme).toContain("Native local send queue");
    expect(readme).toContain("server follow-up handoff");
    expect(readme).toContain("Native new chat action");
    expect(readme).toContain("Native conversation search");
    expect(readme).toContain("Native runtime controls");
    expect(readme).toContain("reasoning effort");
    expect(readme).toContain("Plan Mode");
    expect(readme).toContain("Native handoff from an iPhone chat to the Windows desktop");
    expect(authViewSource).toContain("setupPassword(newPassword)");
    expect(authViewSource).toContain("Pair This iPhone");
    expect(authViewSource).toContain("trustedLogin()");
    expect(authViewSource).toContain("completePairing()");
    expect(authViewSource).toContain("DeviceIdentity.fingerprint");
    expect(settingsSource).toContain("Mobile API");
    expect(settingsSource).toContain("Trusted iPhone");
    expect(settingsSource).toContain("Computer Trusted Devices");
    expect(settingsSource).toContain("renameCurrentDevice()");
    expect(settingsSource).toContain("revokeCurrentDevice()");
    expect(settingsSource).toContain("fetchTrustedDevices()");
    expect(settingsSource).toContain("Completion Alerts");
    expect(settingsSource).toContain("notificationToggle");
    expect(settingsSource).toContain("notificationPermissionDetail");
    expect(publicCopy).not.toMatch(/Mac Host|Mac host|placeholder|contract pending|CODEX WORKBENCH/);
  });
});
