import { describe, expect, test } from "vitest";
import { humanizeErrorMessage } from "./errorMessages.js";

describe("humanizeErrorMessage", () => {
  test("turns expired tokens into a login instruction", () => {
    expect(humanizeErrorMessage("bad token")).toBe("登录过期，请重新输入密码。");
    expect(humanizeErrorMessage({ message: "Unauthorized", statusCode: 401 })).toBe("登录过期，请重新输入密码。");
  });

  test("explains trusted-device and pairing failures", () => {
    expect(humanizeErrorMessage("Trusted device was revoked.")).toBe("这台手机的信任已被撤销或失效。请重新输入密码，或在电脑端重新生成配对码。");
    expect(humanizeErrorMessage("Pairing code expired or was already used.")).toBe("配对码已过期、已使用或填写不完整。请在电脑端重新生成二维码或短码。");
  });

  test("explains sqlite lock and disk IO failures", () => {
    expect(humanizeErrorMessage("SQLITE_IOERR: disk I/O error")).toBe(
      "聊天记录正在写入或被锁，系统会自动重试；如果持续失败，请重启电脑端服务。"
    );
    expect(humanizeErrorMessage("database is locked")).toBe(
      "聊天记录正在写入或被锁，系统会自动重试；如果持续失败，请重启电脑端服务。"
    );
  });

  test("keeps already-friendly Chinese messages", () => {
    expect(humanizeErrorMessage("浏览器已经禁止通知，请在手机浏览器的网站设置里允许通知。")).toBe(
      "浏览器已经禁止通知，请在手机浏览器的网站设置里允许通知。"
    );
  });

  test("turns upload errors into concrete next steps", () => {
    expect(humanizeErrorMessage("Upload is too large")).toBe("单个文件超过 25 MB，请压缩后再传，或分成更小的文件。");
    expect(humanizeErrorMessage("No files uploaded")).toBe("没有收到文件，请重新选择附件后再发送。");
    expect(humanizeErrorMessage("file object lost after refresh")).toBe("浏览器刷新后没有保留这个附件，请重新选择文件后再发送。");
  });

  test("explains websocket and tunnel recovery in plain language", () => {
    expect(humanizeErrorMessage("WebSocket disconnected")).toBe("手机和电脑的连接不稳定，系统正在自动重连；请确认电脑不断网、不休眠。");
    expect(humanizeErrorMessage("Tunnel closed")).toBe("公网通道断开了，电脑端会尝试恢复；如果网址一直打不开，请查看 current-phone-link.txt 或重启电脑端服务。");
  });

  test("explains Codex backend silence separately from generic network errors", () => {
    expect(humanizeErrorMessage("Codex backend no response")).toBe(
      "电脑端暂时没有响应。请先等 10 秒；如果仍无变化，回到电脑确认聊天窗口没卡住，再刷新手机页面。"
    );
  });

  test("explains microphone camera git and stale cache errors", () => {
    expect(humanizeErrorMessage("microphone denied")).toBe("麦克风权限被拒绝。请在浏览器设置里允许麦克风，或用语音备忘录录好后作为文件上传。");
    expect(humanizeErrorMessage("camera unsupported")).toBe("当前浏览器不支持直接拍照入口。请先用相机拍照，再从相册选择图片上传。");
    expect(humanizeErrorMessage("git no upstream")).toBe("当前 Git 分支没有 upstream。请先在电脑端设置远程跟踪分支，再从手机 pull 或 push。");
    expect(humanizeErrorMessage("service worker stale cache")).toBe("手机缓存了旧前端。请点刷新；如果还不行，在诊断里清理 PWA 缓存后重新打开。");
  });
});
