function stringValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === "object") {
    if (typeof value.error === "string") return value.error;
    if (typeof value.message === "string") return value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(value);
}

const ERROR_RULES = [
  {
    patterns: ["wrong password"],
    message: "密码不对，请重新输入。"
  },
  {
    patterns: ["current password is wrong"],
    message: "当前密码不对，请重新输入当前密码。"
  },
  {
    patterns: ["password must be at least"],
    message: "密码至少需要 4 位，请换一个更长的密码。"
  },
  {
    patterns: ["password is already configured"],
    message: "已经设置过访问密码，请直接用现有密码登录。"
  },
  {
    patterns: ["create a password before logging in"],
    message: "还没有设置访问密码，请先在电脑端完成密码设置。"
  },
  {
    patterns: ["trusted device was revoked", "trusted device was revoked or not recognized", "pair again"],
    message: "这台手机的信任已被撤销或失效。请重新输入密码，或在电脑端重新生成配对码。"
  },
  {
    patterns: ["pairing code expired", "pairing code was already used", "pairing code is missing"],
    message: "配对码已过期、已使用或填写不完整。请在电脑端重新生成二维码或短码。"
  },
  {
    patterns: ["bad token", "unauthorized", "invalid refresh token", "session expired", "token refresh failed"],
    message: "登录过期，请重新输入密码。"
  },
  {
    patterns: ["disk i/o error", "disk io error", "sqlite_busy", "sqlite_locked", "database is locked", "database table is locked"],
    message: "聊天记录正在写入或被锁，系统会自动重试；如果持续失败，请重启电脑端服务。"
  },
  {
    patterns: ["database disk image is malformed", "database malformed"],
    message: "聊天记录文件可能损坏。请先重启电脑端服务；如果还失败，打开状态面板查看详情。"
  },
  {
    patterns: ["no space left", "enospc"],
    message: "电脑磁盘空间不足，文件或聊天记录写不进去。请清理磁盘后重试。"
  },
  {
    patterns: ["eacces", "eperm", "permission denied", "access is denied"],
    message: "电脑权限阻止了这次操作。请确认电脑端服务有权限访问对应文件夹，然后重试。"
  },
  {
    patterns: ["request body is too large"],
    message: "这次上传的文件总量太大，请分几次上传。"
  },
  {
    patterns: ["upload is too large"],
    message: "单个文件超过 25 MB，请压缩后再传，或分成更小的文件。"
  },
  {
    patterns: ["upload is empty", "no files uploaded"],
    message: "没有收到文件，请重新选择附件后再发送。"
  },
  {
    patterns: ["failed to read"],
    message: "手机浏览器没有读到这个文件。请重新选择附件；如果是 iCloud 或网盘文件，先下载到本机再上传。"
  },
  {
    patterns: ["attachment was not kept", "file object lost"],
    message: "浏览器刷新后没有保留这个附件，请重新选择文件后再发送。"
  },
  {
    patterns: ["already has an active run", "active run"],
    message: "上一条消息还在处理，这条会先排队，等当前回复结束后继续发送。"
  },
  {
    patterns: ["did not detect codex desktop receiving", "keep codex open", "desktop did not receive message"],
    message: "电脑端没有确认收到手机消息。请确认电脑上的聊天窗口打开并停留在对应对话，然后点重试。"
  },
  {
    patterns: ["codex desktop not detected"],
    message: "没有检测到电脑端聊天窗口。请先在电脑上打开它，再从手机重试。"
  },
  {
    patterns: ["desktop sync failed", "could not refresh codex desktop"],
    message: "电脑端同步失败。请确认电脑上的聊天窗口没有卡住；如果持续失败，请重启电脑端服务。"
  },
  {
    patterns: ["codex backend no response", "codex backend did not respond", "app-server did not respond", "app server did not respond", "codex app-server unavailable"],
    message: "电脑端暂时没有响应。请先等 10 秒；如果仍无变化，回到电脑确认聊天窗口没卡住，再刷新手机页面。"
  },
  {
    patterns: ["request timed out", "timed out", "timeout"],
    message: "网络或电脑端响应超时，系统会自动重试；如果一直失败，请确认电脑没有休眠并刷新手机页面。"
  },
  {
    patterns: ["network interrupted", "network request failed", "failed to fetch", "load failed", "websocket disconnected", "websocket close", "socket hang up", "econnreset", "disconnected"],
    message: "手机和电脑的连接不稳定，系统正在自动重连；请确认电脑不断网、不休眠。"
  },
  {
    patterns: ["thread not found"],
    message: "这条聊天记录没找到，可能已经刷新或移动。请返回聊天列表重新打开。"
  },
  {
    patterns: ["not found"],
    message: "这个页面或接口不存在。请刷新手机页面；如果仍然出现，请重启电脑端服务。"
  },
  {
    patterns: ["invalid json body"],
    message: "请求内容损坏，通常是网络中断导致。请刷新页面后重试。"
  },
  {
    patterns: ["tailscale is not installed", "tailscale unavailable"],
    message: "电脑没有可用的 Tailscale 固定访问通道。请安装并登录 Tailscale，或临时使用 Cloudflare/localhost.run 链接。"
  },
  {
    patterns: ["tailscale needs login"],
    message: "Tailscale 需要重新登录。请在电脑上打开 Tailscale 完成登录。"
  },
  {
    patterns: ["public tunnel became unreachable", "public tunnel url did not become reachable", "tunnel closed", "tunnel disconnected", "tunnel failed"],
    message: "公网通道断开了，电脑端会尝试恢复；如果网址一直打不开，请查看 current-phone-link.txt 或重启电脑端服务。"
  },
  {
    patterns: ["no open port found", "eaddrinuse", "address already in use"],
    message: "本地端口被占用。请关闭旧的电脑端服务，或换一个端口后再启动。"
  },
  {
    patterns: ["microphone denied", "permission denied by system", "notallowederror"],
    message: "麦克风权限被拒绝。请在浏览器设置里允许麦克风，或用语音备忘录录好后作为文件上传。"
  },
  {
    patterns: ["camera unsupported", "capture unsupported"],
    message: "当前浏览器不支持直接拍照入口。请先用相机拍照，再从相册选择图片上传。"
  },
  {
    patterns: ["no upstream", "has no upstream"],
    message: "当前 Git 分支没有 upstream。请先在电脑端设置远程跟踪分支，再从手机 pull 或 push。"
  },
  {
    patterns: ["merge conflict", "automatic merge failed", "conflict"],
    message: "Git 遇到冲突。请在电脑端解决冲突后，再从手机继续。"
  },
  {
    patterns: ["authentication failed", "git auth", "permission denied (publickey)", "could not read username"],
    message: "Git 远程认证失败。请在电脑端检查 GitHub/SSH/凭据登录。"
  },
  {
    patterns: ["stale cache", "service worker stale", "old frontend"],
    message: "手机缓存了旧前端。请点刷新；如果还不行，在诊断里清理 PWA 缓存后重新打开。"
  },
  {
    patterns: ["service unavailable", "gateway timeout", "bad gateway"],
    message: "电脑端服务暂时不可用。请刷新手机页面；如果还不行，重启电脑端服务。"
  },
  {
    patterns: ["internal server error"],
    message: "电脑端服务内部出错。请先刷新页面；如果反复出现，请打开诊断面板或重启电脑端服务。"
  },
  {
    patterns: ["cancelled", "canceled"],
    message: "已停止当前任务。"
  }
];

export function humanizeError(error, options = {}) {
  const raw = stringValue(error || options.message || "");
  const statusCode = Number(options.statusCode || error?.statusCode || 0);
  const retryable = Boolean(options.retryable ?? error?.retryable);
  const lower = raw.toLowerCase();

  for (const rule of ERROR_RULES) {
    if (rule.patterns.some((pattern) => lower.includes(pattern))) {
      return {
        message: rule.message,
        raw,
        statusCode,
        retryable
      };
    }
  }

  if (statusCode === 401) {
    return { message: "登录过期，请重新输入密码。", raw, statusCode, retryable: false };
  }
  if (statusCode === 413) {
    return { message: "上传内容太大，请压缩文件或分几次上传。", raw, statusCode, retryable: false };
  }
  if (statusCode >= 500) {
    return {
      message: retryable
        ? "电脑端服务暂时出错，系统会自动重试；如果持续失败，请重启电脑端服务。"
        : "电脑端服务出错。请刷新页面；如果持续失败，请重启电脑端服务。",
      raw,
      statusCode,
      retryable
    };
  }

  if (!raw) return { message: "出错了。请刷新页面后重试。", raw, statusCode, retryable };
  if (hasChinese(raw)) return { message: raw, raw, statusCode, retryable };
  return {
    message: `出错了：${raw}。请刷新页面后重试；如果反复出现，请打开诊断面板或重启电脑端服务。`,
    raw,
    statusCode,
    retryable
  };
}

export function humanizeErrorMessage(error, options = {}) {
  return humanizeError(error, options).message;
}
