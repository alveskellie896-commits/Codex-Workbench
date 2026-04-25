import SwiftUI

struct AuthenticationView: View {
    @Environment(AppState.self) private var appState
    @State private var password = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var setupMode = SetupMode.connect
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                WorkbenchTheme.pageBackground.ignoresSafeArea()

                Form {
                    Section {
                        FirstRunHero()
                        Picker("模式", selection: $setupMode) {
                            ForEach(SetupMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    .listRowBackground(Color.clear)

                    Section {
                        if setupMode == .connect {
                            SecureField("Host 密码", text: $password)
                                .textContentType(.password)
                            Button("继续", action: login)
                                .disabled(password.isEmpty || isLoading)
                        } else {
                            SecureField("新 Host 密码", text: $newPassword)
                                .textContentType(.newPassword)
                            SecureField("确认新密码", text: $confirmPassword)
                                .textContentType(.newPassword)
                            Button("创建密码并进入", action: setupPassword)
                                .disabled(newPassword.count < 4 || newPassword != confirmPassword || isLoading)
                        }
                    } header: {
                        Text(setupMode.title)
                    } footer: {
                        Text(setupMode.footer)
                    }

                    Section("Host 服务") {
                        HostURLField(hostStore: appState.hostStore)
                    }

                    Section("连接说明") {
                        Label("登录后会同步项目与对话。", systemImage: "folder.badge.gearshape")
                        Text("原生版会复用 Mac 上的 CODEX WORKBENCH Host Service。请确保 Mac 和 iPhone 在同一局域网或 VPN 中。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    if let errorMessage {
                        Section {
                            Text(errorMessage)
                                .foregroundStyle(.red)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("CODEX WORKBENCH")
        }
    }

    private func login() {
        isLoading = true
        errorMessage = nil

        Task {
            await appState.login(password: password)
            errorMessage = appState.errorMessage
            isLoading = false
        }
    }

    private func setupPassword() {
        isLoading = true
        errorMessage = nil

        Task {
            await appState.setupPassword(newPassword)
            errorMessage = appState.errorMessage
            isLoading = false
        }
    }
}

private enum SetupMode: CaseIterable, Identifiable {
    case connect
    case firstRun

    var id: Self { self }

    var title: String {
        switch self {
        case .connect:
            "登录"
        case .firstRun:
            "首次设置"
        }
    }

    var footer: String {
        switch self {
        case .connect:
            "使用 Mac Host Service 已配置的访问密码。"
        case .firstRun:
            "如果这是第一次打开 Host Service，可以在这里创建访问密码。"
        }
    }
}

private struct FirstRunHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            StatusPill(text: "Native SwiftUI", systemImage: "iphone")
            Text("CODEX WORKBENCH")
                .font(.system(.largeTitle, design: .rounded, weight: .black))
                .foregroundStyle(WorkbenchTheme.ink)
            Text("连接到你的 Mac Host Service，在 iPhone 上查看项目、继续对话并控制 Codex 运行。")
                .font(.callout)
                .foregroundStyle(WorkbenchTheme.mutedInk)
        }
        .padding(.vertical, 8)
    }
}
