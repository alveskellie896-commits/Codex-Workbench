# Codex iOS App 傻瓜式安装

这份说明只讲一件事：把这个项目里的原生 iOS App 装到你的 iPhone 上。

## 先说结论

你现在的 Windows 电脑可以继续运行 Codex Workbench 服务，但 **不能直接把 iOS 原生 App 编译安装到 iPhone**。安装 iOS 原生 App 必须有：

- 一台 Mac。
- Mac 上安装 Xcode。
- 一根数据线，或者已经和 Xcode 配对过的 iPhone。
- 一个 Apple ID。免费 Apple ID 可以真机运行开发版；长期稳定分发通常需要 Apple Developer Program。

## Windows 电脑要做什么

Windows 电脑继续负责运行服务：

```powershell
npm run start:public
```

然后确认项目根目录的 `current-phone-link.txt` 里有 `Phone:` 链接。这个链接就是 iOS App 里要填的 Computer URL。

## Mac 要做什么

Mac 负责把 App 编译并装到 iPhone：

1. 安装 Xcode。
2. 登录 Apple ID。
3. 把整个 `Codex-Workbench` 文件夹复制到 Mac。
4. 用 Xcode 打开 `ios/CodexWorkbench/CodexWorkbench.xcodeproj`。

## 最简单安装步骤

### 第一步：Windows 打包项目

在 Windows PowerShell 里进入项目目录：

```powershell
cd C:\Users\keshi\Documents\Codex\2026-04-25\https-github-com-caiqiangting321-hub-codex\Codex-Workbench
```

运行：

```powershell
.\scripts\package-ios-for-mac.ps1
```

脚本会在桌面生成：

```text
Codex-Workbench-iOS.zip
```

把这个 zip 发到 Mac，解压。

### 第二步：Mac 检查工程

在 Mac 的终端里进入解压后的项目目录，例如：

```zsh
cd ~/Downloads/Codex-Workbench
```

运行：

```zsh
chmod +x scripts/ios-mac-check.sh
./scripts/ios-mac-check.sh
```

这个脚本会检查 Xcode 是否可用，做一次模拟器构建检查，然后打开 iOS 工程。

### 第三步：Xcode 里设置签名

打开 Xcode 后：

1. 左侧点最上面的 `CodexWorkbench` 工程。
2. 中间选 `TARGETS` 里的 `CodexWorkbench`。
3. 点 `Signing & Capabilities`。
4. 勾选 `Automatically manage signing`。
5. `Team` 选择你的 Apple ID。
6. 如果 Bundle Identifier 报重复，把它改成独一无二的，比如：

```text
com.keshi.codexworkbench
```

### 第四步：连接 iPhone 并安装

1. iPhone 用数据线连接 Mac。
2. iPhone 上点“信任这台电脑”。
3. 如果提示开启 Developer Mode，按 iPhone 设置里的提示开启，然后重启手机。
4. Xcode 顶部运行目标选择你的 iPhone。
5. 点左上角三角形 Run。

装完后 iPhone 主屏幕会出现 `Codex` App。

## 第一次打开 App 怎么填

第一次打开 iOS App，会看到 Host / Computer URL。

填 Windows 服务给手机用的网址，也就是 `current-phone-link.txt` 里的 `Phone:` 后面那一行，例如：

```text
https://cj-202562739.tail2b27fb.ts.net/
```

然后：

1. 点检查连接。
2. 输入你的 Workbench 密码登录。
3. 或者在电脑网页端创建 pairing code，再在 iOS App 里输入配对码。

## 日常使用

以后你只要：

1. Windows 电脑开机、联网、不休眠。
2. Windows 端运行 Workbench 服务。
3. iPhone 打开 `Codex` App。

就可以用 iOS 原生 App 控制电脑上的 Codex。

## 常见问题

### 没有 Mac 能不能装？

不能在 Windows 本机直接装原生 iOS App。Windows 可以运行服务，也可以开发代码，但不能完成 iOS 编译、签名和真机安装。

如果你没有 Mac，看这个无本地 Mac 方案：

```text
docs/ios-no-mac-testflight-zh.md
```

### 免费 Apple ID 可以吗？

可以用于自己真机调试安装。缺点是证书/有效期和分发能力有限。如果你想长期稳定、TestFlight、给其他设备装，建议 Apple Developer Program。

### 换 API key 会影响 App 吗？

通常不影响。iOS App 连的是你的 Windows Workbench 服务，不直接连 OpenAI。换 API key 后，只要 Windows 服务还能正常调用 Codex，App 继续用同一个 Computer URL。

### 换网址怎么办？

打开 iOS App 的 Settings / Connection，把 Computer URL 改成新的 `Phone:` 链接。

### 电脑关机怎么办？

App 会连不上。原理上 Codex 仍在 Windows 上跑，iPhone 只是原生遥控器。电脑必须在线。
