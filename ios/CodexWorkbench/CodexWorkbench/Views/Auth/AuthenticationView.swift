import SwiftUI

struct AuthenticationView: View {
    @Environment(AppState.self) private var appState
    @State private var password = ""
    @State private var newPassword = ""
    @State private var pairingCode = ""
    @State private var deviceName = DeviceIdentity.defaultName
    @State private var setupMode = SetupMode.signIn
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
                        if setupMode == .signIn {
                            if let trustedDevice = appState.trustedDevice {
                                Button {
                                    trustedLogin()
                                } label: {
                                    Label("Continue as \(trustedDevice.name)", systemImage: "checkmark.shield")
                                }
                                .disabled(isLoading)
                            }

                            SecureField("Computer password", text: $password)
                                .textContentType(.password)
                            Button("继续", action: login)
                                .disabled(password.isEmpty || isLoading)
                        } else {
                            SecureField("New computer password", text: $newPassword)
                                .textContentType(.newPassword)
                            Button("Create Password", action: setupPassword)
                            .disabled(newPassword.count < 8 || isLoading)
                        }
                    } header: {
                        Text(setupMode.title)
                    } footer: {
                        Text(setupMode.footer)
                    }

                    Section("Pair This iPhone") {
                        TextField("Pairing code", text: $pairingCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                        TextField("Device name", text: $deviceName)
                        Button {
                            completePairing()
                        } label: {
                            Label("Pair and Sign In", systemImage: "qrcode.viewfinder")
                        }
                        .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
                    } footer: {
                        Text("Create a pairing code on the computer or browser version, then enter it here. The trusted-device token is stored in Keychain.")
                    }

                    Section("Host") {
                        HostURLField(hostStore: appState.hostStore)
                    }

                    Section("Connection") {
                        SettingsRow(
                            title: appState.connectionTitle,
                            detail: appState.connectionDetail,
                            systemImage: appState.bootstrapErrorMessage == nil ? "checkmark.circle" : "wifi.exclamationmark"
                        )
                        Button("Check Again") {
                            Task {
                                await appState.refreshBootstrap()
                            }
                        }
                        .disabled(appState.isRefreshingBootstrap)
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
            .navigationTitle("First Run")
            .task {
                await appState.refreshBootstrap()
                setupMode = appState.setupRequired ? .firstRun : .signIn
            }
            .onChange(of: appState.setupRequired) {
                setupMode = appState.setupRequired ? .firstRun : .signIn
            }
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

    private func trustedLogin() {
        guard let credential = appState.trustedDevice else {
            errorMessage = "No trusted device is saved. Pair this iPhone first."
            return
        }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                let response = try await appState.apiClient.deviceLogin(
                    credential: credential,
                    fingerprint: DeviceIdentity.fingerprint
                )
                await MainActor.run {
                    appState.updateSession(response.session)
                    if let device = response.device {
                        appState.updateTrustedDevice(
                            TrustedDeviceCredential(
                                deviceId: credential.deviceId,
                                deviceToken: credential.deviceToken,
                                name: device.name,
                                permissionLevel: device.permissionLevel ?? credential.permissionLevel,
                                pairedAt: credential.pairedAt
                            )
                        )
                    }
                    isLoading = false
                }
                await appState.refreshBootstrap()
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func completePairing() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let response = try await appState.apiClient.completePairing(
                    code: pairingCode,
                    deviceName: deviceName,
                    fingerprint: DeviceIdentity.fingerprint
                )
                await MainActor.run {
                    appState.updateTrustedDevice(response.trustedCredential)
                    appState.updateSession(response.session)
                    pairingCode = ""
                    isLoading = false
                }
                await appState.refreshBootstrap()
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func setupPassword() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let session = try await appState.apiClient.setupPassword(newPassword)
                await MainActor.run {
                    appState.updateSession(session)
                    password = ""
                    newPassword = ""
                    isLoading = false
                }
                await appState.refreshBootstrap()
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }
}

private enum SetupMode: CaseIterable, Identifiable {
    case signIn
    case firstRun

    var id: Self { self }

    var title: String {
        switch self {
        case .signIn:
            "Sign In"
        case .firstRun:
            "首次设置"
        }
    }

    var footer: String {
        switch self {
        case .signIn:
            "Use the password configured on the Windows computer service."
        case .firstRun:
            "Create the first password for this computer service."
        }
    }
}

private struct FirstRunHero: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            StatusPill(text: "Native SwiftUI", systemImage: "iphone")
            Text("Codex")
                .font(.system(.largeTitle, design: .rounded, weight: .black))
                .foregroundStyle(WorkbenchTheme.ink)
            Text("Connect this iPhone to the Codex service running on your Windows computer.")
                .font(.callout)
                .foregroundStyle(WorkbenchTheme.mutedInk)
        }
        .padding(.vertical, 8)
    }
}
