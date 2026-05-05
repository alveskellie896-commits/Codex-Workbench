# 没有 Mac 怎么用 iOS 原生 App

你没有 Mac 时，最稳的路线是：

```text
Windows 继续运行 Codex 服务
GitHub Actions 云端 macOS 构建 iOS App
TestFlight 安装到 iPhone
```

这不是绕过苹果限制，而是把“需要 Mac 的编译和签名步骤”放到 GitHub 的云端 macOS runner 上执行。

## 不能绕过的硬条件

你必须准备：

- Apple Developer Program 账号。
- GitHub 仓库。
- App Store Connect 里创建一个 App。
- iOS Distribution 证书。
- App Store provisioning profile。
- App Store Connect API Key。

免费 Apple ID 不适合这个无 Mac 自动分发方案，因为 TestFlight/App Store Connect 分发需要开发者计划。

## 你只需要做一次的设置

### 1. 把项目推到 GitHub

在 GitHub 创建一个私有仓库，然后把这个项目推上去。

### 2. App Store Connect 创建 App

在 App Store Connect 创建新 App：

- Platform: iOS
- Name: Codex
- Bundle ID: 建议 `com.keshi.codexworkbench`
- SKU: 随便填一个唯一值，例如 `codex-workbench-ios`

### 3. Apple Developer 创建签名资料

在 Apple Developer 后台创建：

- Identifier / App ID：和 Bundle ID 一致。
- iOS Distribution certificate，下载后导出成 `.p12`。
- App Store provisioning profile，下载 `.mobileprovision`。

### 4. App Store Connect API Key

在 App Store Connect 的 Users and Access / Integrations 创建 API Key，权限至少能上传 TestFlight 构建。

你会得到：

- Key ID
- Issuer ID
- `.p8` 私钥内容

## GitHub Secrets 怎么填

进入 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions
```

添加这些 Secrets：

```text
APPLE_TEAM_ID
IOS_DISTRIBUTION_CERTIFICATE_BASE64
IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
IOS_KEYCHAIN_PASSWORD
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_API_ISSUER_ID
APP_STORE_CONNECT_API_PRIVATE_KEY
```

添加这个 Variable：

```text
IOS_BUNDLE_ID = com.keshi.codexworkbench
```

## 怎么把证书转成 Base64

在 Windows PowerShell 里：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\certificate.p12")) | Set-Content certificate.p12.base64
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\profile.mobileprovision")) | Set-Content profile.mobileprovision.base64
```

把 `certificate.p12.base64` 的内容填到：

```text
IOS_DISTRIBUTION_CERTIFICATE_BASE64
```

把 `profile.mobileprovision.base64` 的内容填到：

```text
IOS_PROVISIONING_PROFILE_BASE64
```

`IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` 是你导出 `.p12` 时设置的密码。

`IOS_KEYCHAIN_PASSWORD` 可以自己生成一个长密码，只给 GitHub Actions 临时 keychain 用。

`APP_STORE_CONNECT_API_PRIVATE_KEY` 填 `.p8` 文件完整内容，包括：

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

## 怎么开始构建

进入 GitHub 仓库：

```text
Actions -> iOS TestFlight -> Run workflow
```

跑完后会做三件事：

1. 跑项目测试。
2. 在云端 macOS 上构建 iOS App。
3. 上传 IPA 到 TestFlight。

构建成功后，去 TestFlight 等苹果处理完成，然后在 iPhone 的 TestFlight App 里安装。

## iPhone App 第一次打开填什么

Windows 电脑继续运行：

```powershell
npm run start:public
```

然后打开项目里的：

```text
current-phone-link.txt
```

把 `Phone:` 后面的链接填进 iOS App 的 Computer URL。

## 你以后每天怎么用

1. Windows 电脑开机、联网、不休眠。
2. Windows 跑 Workbench 服务。
3. iPhone 打开 TestFlight 安装的 Codex App。
4. 登录或配对后使用。

## 如果失败看哪里

- GitHub Actions 红了：点进去看是哪一步失败。
- 签名失败：通常是 Bundle ID、Team ID、证书、profile 不匹配。
- 上传失败：通常是 App Store Connect API Key 权限不够，或者 App Store Connect 里没创建对应 Bundle ID 的 App。
- iPhone 打不开服务：Windows 服务没跑、公网链接变了、电脑睡眠、Tailscale/Funnel 断了。

