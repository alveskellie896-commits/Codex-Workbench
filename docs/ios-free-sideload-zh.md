# 不花钱安装 iOS 原生 App 的办法

结论：**有免费办法，但体验不如 TestFlight 稳。**

免费路线是：

```text
GitHub Actions 免费云端 macOS 编译 IPA
Windows 安装 AltStore 或 Sideloadly
用免费 Apple ID 把 IPA 侧载到 iPhone
每 7 天刷新一次
```

## 免费方案的限制

- 不能用 TestFlight。
- 不能上 App Store。
- 免费 Apple ID 侧载 App 通常 7 天会过期，需要刷新。
- 免费 Apple ID 同时可用的侧载 App 数量有限，AltStore/SideStore 文档里常见限制是 3 个 active apps。
- 有时 iOS 版本、Apple ID 状态、侧载工具版本会导致失败，需要看具体报错调整。

如果你能接受这些限制，这条路线不需要买 Mac，也不需要 Apple Developer Program。

## 第 1 步：把项目放到 GitHub

打开 GitHub Desktop：

1. `File`
2. `Add local repository`
3. 选择：

```text
C:\Users\keshi\Documents\Codex\2026-04-25\https-github-com-caiqiangting321-hub-codex\Codex-Workbench
```

4. `Publish repository`
5. 如果不介意代码公开，选 Public。Public 仓库用 GitHub Actions 更省免费额度。
6. 如果想私有，选 Private。Private 也有免费额度，但 macOS runner 会消耗额度。

## 第 2 步：在 GitHub 生成免费 IPA

进入你的 GitHub 仓库网页：

```text
Actions -> iOS Free Unsigned IPA -> Run workflow
```

等它跑完。

跑完后点进去下载 artifact：

```text
CodexWorkbench-unsigned-IPA
```

解压后你会得到：

```text
CodexWorkbench-unsigned.ipa
```

## 第 3 步：Windows 安装 AltStore 或 Sideloadly

二选一：

- AltStore: https://altstore.io/
- Sideloadly: https://sideloadly.io/

我建议先试 Sideloadly，因为流程更直白：

1. Windows 安装 Sideloadly。
2. 安装 Apple 官方 iTunes 和 iCloud，最好用 Apple 官网版本，不要用 Microsoft Store 版本。
3. iPhone 用数据线连接电脑。
4. iPhone 点“信任这台电脑”。
5. 打开 Sideloadly。
6. 把 `CodexWorkbench-unsigned.ipa` 拖进去。
7. 输入 Apple ID。
8. 点 Start。

如果它要求输入 Apple ID 密码或 app-specific password，按它提示来。

## 第 4 步：iPhone 信任开发者

安装完成后，iPhone 可能打不开 App。

去：

```text
设置 -> 通用 -> VPN 与设备管理
```

找到你的 Apple ID，点信任。

然后回桌面打开 `Codex`。

## 第 5 步：第一次打开 App 填网址

Windows 电脑运行：

```powershell
npm run start:public
```

打开项目根目录：

```text
current-phone-link.txt
```

把 `Phone:` 后面的链接填进 iOS App 的 Computer URL。

## 第 6 步：7 天刷新

免费 Apple ID 侧载通常需要 7 天刷新一次。

如果用 Sideloadly：

```text
电脑和 iPhone 在附近 -> 打开 Sideloadly -> 重新 Start 或开启自动刷新
```

如果用 AltStore：

```text
打开 AltStore -> My Apps -> Refresh All
```

## 我建议你的选择

如果你一分钱都不想花：

```text
先用免费侧载方案
```

如果你以后觉得 7 天刷新太烦，再考虑：

```text
Apple Developer Program + TestFlight
```

## 已经给你准备好的 GitHub workflow

项目里已经有：

```text
.github/workflows/ios-free-unsigned-ipa.yml
```

它不需要 Apple 证书，也不需要 GitHub Secrets。

