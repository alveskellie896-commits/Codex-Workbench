# CODEX WORKBENCH

CODEX WORKBENCH 是一个面向 Codex Desktop 的本地优先远程工作台，支持在手机端查看项目与对话线程、同步聊天历史、继续发送消息、查看工具执行状态、上传附件、切换模型，并通过本机 Host Service 与 Codex Desktop 状态保持同步。

项目包含移动端 PWA、Node.js 本机桥接服务，以及正在开发中的原生 SwiftUI iOS 客户端，目标是让用户在手机上获得接近桌面版 Codex 的完整操作体验。

## What is included

- Local host service that reads Codex Desktop state and exposes authenticated HTTP/WebSocket APIs.
- Mobile PWA for browsing projects, opening threads, viewing message/tool history, sending messages, stopping runs, retrying, uploading attachments, and changing models.
- Native SwiftUI iOS app skeleton under `ios/CodexWorkbench`, intended for a future App Store-ready client.

## Run the web workbench

```bash
npm install
cp .env.example .env
npm start
```

For LAN/mobile access, set:

```bash
CODEX_REMOTE_HOST=0.0.0.0
CODEX_REMOTE_PORT=8787
CODEX_REMOTE_PASSWORD=change-this-password
```

Then open:

```text
http://<your-mac-lan-ip>:8787/
```

## Development

```bash
npm test
npm run build
```

## iOS app

The native SwiftUI app is in:

```text
ios/CodexWorkbench
```

It is currently an App Store-oriented native skeleton that targets the existing CODEX WORKBENCH host service. See `ios/CodexWorkbench/README.md` for iOS-specific notes.

## Security notes

- Do not expose the host service directly to the public internet.
- Use a VPN or trusted LAN for first versions.
- Keep real `.env` files, local Codex state, tokens, and uploads out of Git.
