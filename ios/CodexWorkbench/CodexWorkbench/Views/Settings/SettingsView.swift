import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var trustedDevices: [TrustedDevice] = []
    @State private var deviceNameDraft = ""
    @State private var isLoadingDevices = false
    @State private var deviceErrorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                WorkbenchTheme.pageBackground.ignoresSafeArea()

                Form {
                    Section("Computer Service") {
                        NavigationLink {
                            HostConfigView()
                        } label: {
                            SettingsRow(
                                title: "Connection",
                                detail: appState.hostStore.hostURL.absoluteString,
                                systemImage: "server.rack"
                            )
                        }
                        Text("Use the URL shown by the Windows computer service, including a public phone link when the iPhone is not on the same network.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Section("Service Status") {
                        SettingsRow(
                            title: appState.connectionTitle,
                            detail: appState.connectionDetail,
                            systemImage: appState.bootstrapErrorMessage == nil ? "checkmark.circle" : "wifi.exclamationmark"
                        )
                        if let bootstrap = appState.bootstrapInfo {
                            SettingsRow(
                                title: "Mobile API",
                                detail: "v\(bootstrap.apiVersion) · \(bootstrap.platformTarget)",
                                systemImage: "iphone"
                            )
                            if let buildId = bootstrap.service.buildId, buildId.isEmpty == false {
                                SettingsRow(title: "Build", detail: buildId, systemImage: "hammer")
                            }
                            if let limit = bootstrap.limits.upload?.maxFileBytes {
                                SettingsRow(
                                    title: "Upload Limit",
                                    detail: ByteCountFormatter.string(fromByteCount: Int64(limit), countStyle: .file),
                                    systemImage: "paperclip"
                                )
                            }
                        }
                        Button("Refresh Status") {
                            Task {
                                await appState.refreshBootstrap()
                            }
                        }
                        .disabled(appState.isRefreshingBootstrap)
                    }

                    Section("Trusted iPhone") {
                        if let trustedDevice = appState.trustedDevice {
                            SettingsRow(
                                title: trustedDevice.name,
                                detail: "Trusted device - \(trustedDevice.permissionLevel)",
                                systemImage: "checkmark.shield"
                            )
                            TextField("Device name", text: $deviceNameDraft)
                            HStack {
                                Button("Rename") {
                                    renameCurrentDevice()
                                }
                                .disabled(deviceNameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoadingDevices)

                                Button("Forget on This iPhone", role: .destructive) {
                                    appState.forgetTrustedDevice()
                                    deviceNameDraft = ""
                                }
                            }
                            Button("Revoke From Computer", role: .destructive) {
                                revokeCurrentDevice()
                            }
                            .disabled(isLoadingDevices)
                        } else {
                            SettingsRow(
                                title: "Not Paired",
                                detail: "Pair from the sign-in screen to enable trusted login",
                                systemImage: "shield.slash"
                            )
                        }

                        Button("Refresh Devices") {
                            loadTrustedDevices()
                        }
                        .disabled(isLoadingDevices)

                        if let deviceErrorMessage {
                            Text(deviceErrorMessage)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }

                    if trustedDevices.isEmpty == false {
                        Section("Computer Trusted Devices") {
                            ForEach(trustedDevices) { device in
                                TrustedDeviceRow(
                                    device: device,
                                    isCurrent: device.id == appState.trustedDevice?.deviceId,
                                    revoke: { revokeDevice(device.id) }
                                )
                            }
                        }
                    }

                    Section("Notifications") {
                        Toggle("Completion Alerts", isOn: notificationToggle)
                        SettingsRow(
                            title: "Permission",
                            detail: notificationPermissionDetail,
                            systemImage: "bell.badge"
                        )
                        Text("Local alerts can tell you when the current Codex task finishes, fails, or needs attention. Background delivery is limited to local notifications while this app receives run updates.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Section("Account") {
                        Button("Sign Out", role: .destructive) {
                            appState.signOut()
                        }
                    }

                    Section("同步状态") {
                        SettingsRow(
                            title: "WebSocket",
                            detail: connectionText,
                            systemImage: "dot.radiowaves.left.and.right"
                        )
                        if let systemStatus = appState.systemStatus {
                            SettingsRow(
                                title: "Host",
                                detail: systemStatus.hostOnline ? "在线 · \(systemStatus.activeRuns) 个运行中任务" : "离线",
                                systemImage: "server.rack"
                            )
                        }
                    }

                    Section("Interface") {
                        SettingsRow(
                            title: "Projects",
                            detail: "Browse Windows Codex projects and conversations",
                            systemImage: "rectangle.stack"
                        )
                        SettingsRow(
                            title: "Subthreads",
                            detail: "Multi-agent threads collapsed by default",
                            systemImage: "person.2.wave.2"
                        )
                    }

                    Section("App Store Readiness") {
                        Label("Uses public Apple APIs only", systemImage: "checkmark.seal")
                        Label("Includes local network usage purpose string", systemImage: "network")
                        Label("HTTP is limited to local-network ATS policy", systemImage: "lock.shield")
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
            .task {
                syncDeviceDraft()
                loadTrustedDevices()
                await appState.refreshNotificationStatus()
            }
            .onChange(of: appState.trustedDevice) {
                syncDeviceDraft()
            }
        }
    }

    private var notificationToggle: Binding<Bool> {
        Binding(
            get: { appState.notificationsEnabled },
            set: { enabled in
                Task {
                    await appState.setNotificationsEnabled(enabled)
                }
            }
        )
    }

    private var notificationPermissionDetail: String {
        switch appState.notificationPermissionStatus {
        case .authorized:
            "Allowed"
        case .provisional:
            "Quiet alerts allowed"
        case .ephemeral:
            "Temporary alerts allowed"
        case .denied:
            "Denied in iOS Settings"
        case .notDetermined:
            "Not requested"
        case .unknown:
            "Unknown"
        }
    }

    private func syncDeviceDraft() {
        deviceNameDraft = appState.trustedDevice?.name ?? DeviceIdentity.defaultName
    }

    private func loadTrustedDevices() {
        guard appState.session != nil else {
            return
        }
        isLoadingDevices = true
        deviceErrorMessage = nil

        Task {
            do {
                let devices = try await appState.apiClient.fetchTrustedDevices()
                await MainActor.run {
                    trustedDevices = devices
                    isLoadingDevices = false
                }
            } catch {
                await MainActor.run {
                    deviceErrorMessage = error.localizedDescription
                    isLoadingDevices = false
                }
            }
        }
    }

    private func renameCurrentDevice() {
        guard let credential = appState.trustedDevice else {
            return
        }
        let nextName = deviceNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard nextName.isEmpty == false else {
            return
        }

        isLoadingDevices = true
        deviceErrorMessage = nil

        Task {
            do {
                let device = try await appState.apiClient.renameTrustedDevice(deviceID: credential.deviceId, name: nextName)
                await MainActor.run {
                    appState.updateTrustedDevice(
                        TrustedDeviceCredential(
                            deviceId: credential.deviceId,
                            deviceToken: credential.deviceToken,
                            name: device.name,
                            permissionLevel: device.permissionLevel ?? credential.permissionLevel,
                            pairedAt: credential.pairedAt
                        )
                    )
                    isLoadingDevices = false
                }
                loadTrustedDevices()
            } catch {
                await MainActor.run {
                    deviceErrorMessage = error.localizedDescription
                    isLoadingDevices = false
                }
            }
        }
    }

    private func revokeCurrentDevice() {
        guard let deviceId = appState.trustedDevice?.deviceId else {
            return
        }
        revokeDevice(deviceId)
    }

    private func revokeDevice(_ deviceId: String) {
        isLoadingDevices = true
        deviceErrorMessage = nil

        Task {
            do {
                _ = try await appState.apiClient.revokeTrustedDevice(deviceID: deviceId)
                await MainActor.run {
                    if appState.trustedDevice?.deviceId == deviceId {
                        appState.forgetTrustedDevice()
                        appState.signOut()
                        trustedDevices = []
                    } else {
                        trustedDevices.removeAll { $0.id == deviceId }
                    }
                    isLoadingDevices = false
                }
            } catch {
                await MainActor.run {
                    deviceErrorMessage = error.localizedDescription
                    isLoadingDevices = false
                }
            }
        }
    }

    private var connectionText: String {
        switch appState.connectionState {
        case .offline:
            "离线"
        case .connecting:
            "连接中"
        case .online:
            "在线"
        }
    }
}

struct SettingsRow: View {
    let title: String
    let detail: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .frame(width: 28, height: 28)
                .foregroundStyle(WorkbenchTheme.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

struct HostURLField: View {
    @Bindable var hostStore: HostURLStore
    @State private var hostText: String
    @State private var errorMessage: String?

    init(hostStore: HostURLStore) {
        self.hostStore = hostStore
        _hostText = State(initialValue: hostStore.hostURL.absoluteString)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Host URL", text: $hostText)

            HStack {
                Button("Save Host", action: save)
                Button("Use Default") {
                    hostText = HostURLStore.defaultHostString
                    save()
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func save() {
        do {
            let url = try hostStore.update(from: hostText)
            hostText = url.absoluteString
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct TrustedDeviceRow: View {
    let device: TrustedDevice
    let isCurrent: Bool
    let revoke: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: device.isRevoked ? "shield.slash" : "iphone")
                .frame(width: 28, height: 28)
                .foregroundStyle(device.isRevoked ? WorkbenchTheme.mutedInk : WorkbenchTheme.accent)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(device.name)
                    if isCurrent {
                        StatusPill(text: "This iPhone", systemImage: "checkmark", tint: WorkbenchTheme.accent)
                    }
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if device.isRevoked == false {
                Button("Revoke", role: .destructive, action: revoke)
                    .font(.caption)
            }
        }
    }

    private var detail: String {
        let level = device.permissionLevel ?? "phone"
        if device.isRevoked {
            return "\(level) - revoked"
        }
        if let lastSeenAt = device.lastSeenAt, lastSeenAt.isEmpty == false {
            return "\(level) - last seen \(lastSeenAt)"
        }
        return level
    }
}
