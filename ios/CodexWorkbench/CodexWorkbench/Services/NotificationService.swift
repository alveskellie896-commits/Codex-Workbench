import Foundation
import UserNotifications

enum NotificationPermissionStatus: String, Codable, Hashable, Sendable {
    case notDetermined
    case denied
    case authorized
    case provisional
    case ephemeral
    case unknown
}

final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    private let center: UNUserNotificationCenter
    private let userDefaults: UserDefaults
    private let enabledKey = "codexWorkbench.nativeNotificationsEnabled"

    init(
        center: UNUserNotificationCenter = .current(),
        userDefaults: UserDefaults = .standard
    ) {
        self.center = center
        self.userDefaults = userDefaults
        super.init()
        center.delegate = self
    }

    var isEnabled: Bool {
        get {
            userDefaults.bool(forKey: enabledKey)
        }
        set {
            userDefaults.set(newValue, forKey: enabledKey)
        }
    }

    func permissionStatus() async -> NotificationPermissionStatus {
        let settings = await center.notificationSettings()
        return status(from: settings.authorizationStatus)
    }

    @discardableResult
    func requestAuthorization() async throws -> NotificationPermissionStatus {
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        isEnabled = granted
        return await permissionStatus()
    }

    func setEnabled(_ enabled: Bool) async throws -> NotificationPermissionStatus {
        if enabled {
            return try await requestAuthorization()
        }
        isEnabled = false
        return await permissionStatus()
    }

    func notifyThreadCompleted(title: String, body: String, threadID: String) async {
        await post(title: title, body: body, threadID: threadID, tone: "complete")
    }

    func notifyThreadFailed(title: String, body: String, threadID: String) async {
        await post(title: title, body: body, threadID: threadID, tone: "failed")
    }

    private func post(title: String, body: String, threadID: String, tone: String) async {
        guard isEnabled else {
            return
        }
        let status = await permissionStatus()
        guard status == .authorized || status == .provisional || status == .ephemeral else {
            return
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["threadId": threadID, "tone": tone]

        let request = UNNotificationRequest(
            identifier: "codex-thread-\(threadID)-\(tone)-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    private func status(from value: UNAuthorizationStatus) -> NotificationPermissionStatus {
        switch value {
        case .notDetermined:
            .notDetermined
        case .denied:
            .denied
        case .authorized:
            .authorized
        case .provisional:
            .provisional
        case .ephemeral:
            .ephemeral
        @unknown default:
            .unknown
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}
