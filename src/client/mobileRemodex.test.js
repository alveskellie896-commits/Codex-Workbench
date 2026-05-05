import fs from "node:fs";
import { describe, expect, test } from "vitest";

describe("mobile PWA CSS guardrails", () => {
  const mobileCss = fs.readFileSync("src/client/mobileRemodex.css", "utf8");
  const baseCss = fs.readFileSync("src/client/styles.css", "utf8");

  test("keeps iPhone keyboard and safe-area hooks", () => {
    expect(baseCss).toContain("--visual-height");
    expect(baseCss).toContain("--keyboard-inset");
    expect(baseCss).toContain("env(safe-area-inset-bottom)");
    expect(mobileCss).toContain(':root[data-keyboard="open"] .composer');
    expect(mobileCss).toContain(':root[data-keyboard="open"] .messages');
  });

  test("keeps tappable composer controls at mobile size", () => {
    expect(baseCss).toMatch(/height:\s*3\.2rem/);
    expect(baseCss).toMatch(/width:\s*3\.2rem/);
    expect(mobileCss).toContain("touch-action");
  });

  test("keeps the Remodex hard reset as the final mobile layer", () => {
    const hardResetIndex = mobileCss.lastIndexOf("Remodex hard reset");
    expect(hardResetIndex).toBeGreaterThan(mobileCss.indexOf("Usability reset"));
    expect(mobileCss.slice(hardResetIndex)).toContain(".remodex-sidebar-header");
    expect(mobileCss.slice(hardResetIndex)).toContain(".composer-runtime-row");
    expect(mobileCss.slice(hardResetIndex)).toContain(':root[data-keyboard="open"] .composer-runtime-row');
    expect(mobileCss.slice(hardResetIndex)).toContain(':root[data-keyboard="open"] .live-status-row');
    expect(mobileCss.slice(hardResetIndex)).toContain("position: sticky");
    expect(mobileCss.slice(hardResetIndex)).toContain("bottom: 0");
    expect(mobileCss.indexOf("Remodex hard reset")).toBe(hardResetIndex);
  });

  test("removes dashboard chrome from the final mobile experience", () => {
    const hardReset = mobileCss.slice(mobileCss.lastIndexOf("Remodex hard reset"));
    expect(hardReset).toContain(".quick-remote-strip");
    expect(hardReset).toContain(".thread-command-header");
    expect(hardReset).toContain(".home-chat-panel");
    expect(hardReset).toContain("display: grid");
    expect(baseCss).not.toContain(".project-health-strip");
  });

  test("keeps the phone UI closer to Remodex than a card dashboard", () => {
    const hardReset = mobileCss.slice(mobileCss.lastIndexOf("Remodex hard reset"));
    expect(hardReset).toContain(".message-avatar");
    expect(hardReset).toContain("display: none !important");
    expect(hardReset).toContain("position: relative");
    expect(hardReset).toContain("backdrop-filter: blur(22px)");
    expect(hardReset).not.toContain(".thread-filter-tabs");
    expect(hardReset).not.toContain(".quick-template-row");
    expect(hardReset).not.toContain(".spotlight-thread-row");
    expect(hardReset).not.toContain(".attention-thread-row");
    expect(hardReset).toContain(".thread-date-group");
    expect(mobileCss.length).toBeLessThan(39000);
  });

  test("keeps project-scoped Remodex sidebar controls lightweight", () => {
    const hardReset = mobileCss.slice(mobileCss.lastIndexOf("Remodex hard reset"));
    expect(hardReset).toContain(".project-new-chat-button");
    expect(hardReset).not.toContain(".remodex-sidebar-footer");
    expect(hardReset).toContain(".thread-row-actions");
    expect(hardReset).toContain("display: none !important");
    expect(hardReset).not.toContain(".advanced-fab");
    expect(hardReset).not.toContain(".advanced-panel");
    expect(hardReset).toContain(".sidebar-menu-panel");
    expect(hardReset).not.toContain(".meta-pill");
  });

  test("keeps mobile composer focused on the native chat path", () => {
    const appSource = fs.readFileSync("src/client/App.jsx", "utf8");
    const composerStart = appSource.indexOf("function Composer(");
    const composerSource = appSource.slice(composerStart);
    const hardReset = mobileCss.slice(mobileCss.lastIndexOf("Remodex hard reset"));
    const textareaIndex = composerSource.indexOf("<textarea");
    const actionsIndex = composerSource.indexOf('<div className="composer-actions">');
    const menuIndex = composerSource.indexOf('<details className="composer-options-menu"');

    expect(composerSource).toContain('placeholder="输入消息"');
    expect(composerSource).toContain('className="composer-right-actions"');
    expect(composerSource).toContain('className="composer-stop-button"');
    expect(textareaIndex).toBeGreaterThan(-1);
    expect(actionsIndex).toBeGreaterThan(textareaIndex);
    expect(menuIndex).toBeGreaterThan(actionsIndex);
    expect(composerSource.slice(actionsIndex, menuIndex)).not.toContain("<CameraIcon");
    expect(composerSource.slice(actionsIndex, menuIndex)).not.toContain("<MicIcon");
    expect(hardReset).toContain(".composer-options-panel");
    expect(hardReset).toContain("transform: rotate(45deg)");
    expect(hardReset).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(hardReset).toContain(".composer-right-actions");
    expect(hardReset).toContain("min-height: 2.96rem");
    expect(hardReset).toContain("max-height: 4.4rem");
    expect(composerSource).not.toContain("composer-template-row");
  });

  test("keeps runtime and message metadata out of the primary mobile surface", () => {
    const hardReset = mobileCss.slice(mobileCss.lastIndexOf("Remodex hard reset"));
    expect(hardReset).toContain(".composer-options-panel");
    expect(hardReset).toContain(".composer-runtime-row");
    expect(hardReset).toContain("border-top: 1px solid rgba(17, 17, 17, 0.06)");
    expect(hardReset).toContain(".message-footer");
    expect(hardReset).toContain("display: none");
    expect(hardReset).toContain(".trace-actions .inline-action-button");
    expect(hardReset).toContain("display: none");
  });

  test("keeps final mobile language calm and non-technical", () => {
    const appSource = fs.readFileSync("src/client/App.jsx", "utf8");
    const mainSource = fs.readFileSync("src/client/main.jsx", "utf8");
    const projectListSource = appSource.slice(appSource.indexOf("export function ProjectList("), appSource.indexOf("function ThreadQuickActions("));
    expect(appSource).toContain('placeholder="问任何问题"');
    expect(appSource).not.toContain("QUICK_PROMPT_TEMPLATES");
    expect(appSource).not.toContain("home-template-grid");
    expect(appSource).not.toContain("composer-template-row");
    expect(projectListSource).toContain("历史记录");
    expect(projectListSource).not.toContain("继续聊天");
    expect(projectListSource).not.toContain("进行中");
    expect(projectListSource).not.toContain("在线");
    expect(projectListSource).not.toContain("重连中");
    expect(projectListSource).not.toContain("meta-pill");
    expect(appSource).not.toContain('label: "/status"');
    expect(appSource).not.toContain('label: "/model"');
    expect(appSource).not.toContain('aria-label="Password settings"');
    expect(appSource).not.toContain('aria-label="Sign out"');
    expect(mainSource).toContain("刷新页面");
    expect(mainSource).not.toContain("mountAdvancedWorkbench");
    expect(mainSource).not.toContain("advancedWorkbench");
    expect(mainSource).not.toContain("Client error");
    expect(mainSource).not.toContain("Refresh page");
  });

  test("keeps sidebar and composer visually quiet on mobile", () => {
    const hardReset = mobileCss.slice(mobileCss.lastIndexOf("Remodex hard reset"));
    expect(hardReset).toContain("padding: calc(0.86rem + env(safe-area-inset-top)) 0.72rem 0");
    expect(hardReset).toContain("min-height: 2.34rem");
    expect(hardReset).toContain("min-height: 2.96rem");
    expect(hardReset).toContain("box-shadow: 0 10px 28px");
    expect(hardReset).not.toContain("radial-gradient");
    expect(hardReset).not.toContain("任务概览");
  });

  test("keeps service worker from serving stale app shells", () => {
    const serviceWorker = fs.readFileSync("public/sw.js", "utf8");
    expect(serviceWorker).toContain('fetch(new Request(request, { cache: "reload" }))');
    expect(serviceWorker).not.toContain('cache.put("/", response.clone())');
    expect(serviceWorker).not.toContain('caches.match("/")');
    expect(serviceWorker).toContain("CLEAR_OLD_CACHES");
    expect(serviceWorker).toContain("CACHE_PREFIX");
  });
});
