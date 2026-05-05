import Foundation
import Observation

@Observable
final class AppState {
    var selectedProject: ProjectSummary?
    var selectedThread: ThreadSummary?
    var session: AuthSession?
    var trustedDevice: TrustedDeviceCredential?
    var bootstrapInfo: MobileBootstrap?
    var authStatus: AuthStatus?
    var isRefreshingBootstrap = false
    var bootstrapErrorMessage: String?
    var notificationsEnabled = false
    var notificationPermissionStatus = NotificationPermissionStatus.notDetermined

    let hostStore: HostURLStore
    let tokenStore: TokenStore
    let apiClient: APIClient
    let webSocketClient: WebSocketClient
    let notificationService: NotificationService

    init(
        hostStore: HostURLStore,
        tokenStore: TokenStore,
        apiClient: APIClient,
        webSocketClient: WebSocketClient,
        notificationService: NotificationService
    ) {
        self.hostStore = hostStore
        self.tokenStore = tokenStore
        self.apiClient = apiClient
        self.webSocketClient = webSocketClient
        self.notificationService = notificationService
        self.session = tokenStore.loadSession()
        self.trustedDevice = tokenStore.loadTrustedDevice()
        self.notificationsEnabled = notificationService.isEnabled
    }

    static func bootstrap() -> AppState {
        let hostStore = HostURLStore()
        let tokenStore = KeychainTokenStore()
        let apiClient = APIClient(hostStore: hostStore, tokenStore: tokenStore)
        let webSocketClient = WebSocketClient(hostStore: hostStore, tokenStore: tokenStore)
        let notificationService = NotificationService()

        return AppState(
            hostStore: hostStore,
            tokenStore: tokenStore,
            apiClient: apiClient,
            webSocketClient: webSocketClient,
            notificationService: notificationService
        )
    }

    var setupRequired: Bool {
        bootstrapInfo?.auth.setupRequired ?? authStatus?.setupRequired ?? false
    }

    var connectionTitle: String {
        if isRefreshingBootstrap {
            return "Checking computer"
        }
        if bootstrapErrorMessage != nil {
            return "Computer unreachable"
        }
        guard let bootstrapInfo else {
            return "Not checked"
        }
        if bootstrapInfo.auth.authenticated {
            return "Connected"
        }
        return bootstrapInfo.auth.setupRequired ? "Setup required" : "Ready to sign in"
    }

    var connectionDetail: String {
        if let bootstrapErrorMessage {
            return bootstrapErrorMessage
        }
        guard let bootstrapInfo else {
            return hostStore.hostURL.absoluteString
        }
        let serviceName = bootstrapInfo.service.name
        let sendMode = bootstrapInfo.service.sendMode.map { " - \($0)" } ?? ""
        return "\(serviceName)\(sendMode)"
    }

    @MainActor
    func refreshBootstrap() async {
        isRefreshingBootstrap = true
        defer { isRefreshingBootstrap = false }

        if let session, session.isExpired, session.refreshToken != nil {
            do {
                updateSession(try await apiClient.refresh())
            } catch {
                updateSession(nil)
            }
        }

        do {
            var bootstrap = try await apiClient.mobileBootstrap()
            if session != nil, bootstrap.auth.authenticated == false, tokenStore.loadSession()?.refreshToken != nil {
                do {
                    updateSession(try await apiClient.refresh())
                    bootstrap = try await apiClient.mobileBootstrap()
                } catch {
                    updateSession(nil)
                }
            }
            bootstrapInfo = bootstrap
            authStatus = AuthStatus(
                configured: bootstrap.auth.setupRequired == false,
                setupRequired: bootstrap.auth.setupRequired,
                source: bootstrap.auth.authenticated ? "session" : "bootstrap"
            )
            bootstrapErrorMessage = nil
        } catch {
            bootstrapErrorMessage = error.localizedDescription
        }
    }

    @MainActor
    func refreshNotificationStatus() async {
        notificationsEnabled = notificationService.isEnabled
        notificationPermissionStatus = await notificationService.permissionStatus()
    }

    @MainActor
    func setNotificationsEnabled(_ enabled: Bool) async {
        do {
            notificationPermissionStatus = try await notificationService.setEnabled(enabled)
            notificationsEnabled = notificationService.isEnabled
        } catch {
            notificationsEnabled = false
            notificationService.isEnabled = false
            notificationPermissionStatus = await notificationService.permissionStatus()
        }
    }

    @MainActor
    func foregroundRefresh() async {
        await refreshBootstrap()
        await refreshNotificationStatus()
    }

    @MainActor
    func updateSession(_ session: AuthSession?) {
        self.session = session
        tokenStore.saveSession(session)
    }

    @MainActor
    func updateTrustedDevice(_ credential: TrustedDeviceCredential?) {
        self.trustedDevice = credential
        tokenStore.saveTrustedDevice(credential)
    }

    @MainActor
    func signOut() {
        updateSession(nil)
    }

    @MainActor
    func forgetTrustedDevice() {
        updateTrustedDevice(nil)
    }
}
