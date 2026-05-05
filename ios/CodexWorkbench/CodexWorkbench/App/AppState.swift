import Foundation
import Observation

@MainActor
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

    private var realtimeTask: Task<Void, Never>?

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
        if session == nil {
            realtimeTask?.cancel()
            realtimeTask = nil
            webSocketClient.disconnect()
            connectionState = .offline
            projects = []
            threadsByProject = [:]
            messagesByThread = [:]
            runStatesByThread = [:]
            selectedProject = nil
            selectedThread = nil
        }
    }

    func refreshAll() async {
        async let projectsTask: Void = loadProjects()
        async let statusTask: Void = loadSystemStatus()
        async let modelsTask: Void = loadModels()
        _ = await (projectsTask, statusTask, modelsTask)
    }

    func loadProjects() async {
        isLoadingProjects = true
        defer { isLoadingProjects = false }
        do {
            projects = try await apiClient.fetchProjects()
            if selectedProject == nil {
                selectedProject = projects.first
            } else if let selectedProject {
                self.selectedProject = projects.first { $0.id == selectedProject.id } ?? selectedProject
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectProject(_ project: ProjectSummary?) {
        selectedProject = project
        selectedThread = nil
        guard let project else { return }
        Task {
            await loadThreads(for: project)
        }
    }

    func loadThreads(for project: ProjectSummary) async {
        loadingProjectIDs.insert(project.id)
        defer { loadingProjectIDs.remove(project.id) }
        do {
            let threads = try await apiClient.fetchThreads(projectID: project.id)
            threadsByProject[project.id] = threads
            if selectedThread == nil {
                selectedThread = threads.first
            } else if let selectedThread, selectedThread.projectId == project.id {
                self.selectedThread = threads.first { $0.id == selectedThread.id } ?? selectedThread
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func threads(for project: ProjectSummary) -> [ThreadSummary] {
        threadsByProject[project.id] ?? project.recentThreads
    }

    func selectThread(_ thread: ThreadSummary?) {
        selectedThread = thread
        guard let thread else { return }
        Task {
            await loadThread(thread)
        }
    }

    func loadThread(_ thread: ThreadSummary) async {
        loadingThreadIDs.insert(thread.id)
        defer { loadingThreadIDs.remove(thread.id) }
        do {
            let detail = try await apiClient.fetchThread(threadID: thread.id)
            selectedThread = detail.thread
            messagesByThread[thread.id] = detail.messages
            if let state = detail.state {
                runStatesByThread[thread.id] = state
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func messages(for thread: ThreadSummary) -> [MessageEvent] {
        messagesByThread[thread.id] ?? []
    }

    func runState(for thread: ThreadSummary) -> ThreadRunState {
        runStatesByThread[thread.id] ?? thread.runState
    }

    func loadModels() async {
        do {
            availableModels = try await apiClient.fetchModels()
        } catch {
            availableModels = []
        }
    }

    func loadSystemStatus() async {
        do {
            systemStatus = try await apiClient.systemStatus()
        } catch {
            systemStatus = nil
        }
    }

    func sendMessage(thread: ThreadSummary, content: String, model: String?) async {
        let optimistic = MessageEvent(
            id: "local-\(thread.id)-\(Date().timeIntervalSince1970)",
            threadId: thread.id,
            role: .user,
            content: content,
            createdAt: Date()
        )
        messagesByThread[thread.id, default: []].append(optimistic)
        runStatesByThread[thread.id] = .queued

        do {
            let detail = try await apiClient.sendMessage(
                threadID: thread.id,
                content: content,
                model: model,
                attachmentIDs: []
            )
            selectedThread = detail.thread
            messagesByThread[thread.id] = detail.messages
            runStatesByThread[thread.id] = detail.state ?? detail.thread.runState
            errorMessage = nil
        } catch {
            runStatesByThread[thread.id] = .failed
            errorMessage = error.localizedDescription
        }
    }

    func cancel(thread: ThreadSummary) async {
        runStatesByThread[thread.id] = .cancelling
        do {
            try await apiClient.cancelRun(threadID: thread.id)
            await loadThread(thread)
        } catch {
            runStatesByThread[thread.id] = .failed
            errorMessage = error.localizedDescription
        }
    }

    func retry(thread: ThreadSummary) async {
        runStatesByThread[thread.id] = .queued
        do {
            let detail = try await apiClient.retry(threadID: thread.id)
            selectedThread = detail.thread
            messagesByThread[thread.id] = detail.messages
            runStatesByThread[thread.id] = detail.state ?? detail.thread.runState
            errorMessage = nil
        } catch {
            runStatesByThread[thread.id] = .failed
            errorMessage = error.localizedDescription
        }
    }

    func startRealtime() {
        realtimeTask?.cancel()
        connectionState = .connecting
        realtimeTask = Task { [weak self] in
            guard let self else { return }
            do {
                let stream = try webSocketClient.connect()
                connectionState = .online
                for try await event in stream {
                    await handleSocketEvent(event)
                }
            } catch {
                connectionState = .offline
                errorMessage = error.localizedDescription
            }
        }
    }

    private func handleSocketEvent(_ event: WorkbenchSocketEvent) async {
        switch event.type {
        case .systemConnected:
            connectionState = .online
        case .projectUpdated, .threadUpdated:
            await loadProjects()
            if let selectedProject {
                await loadThreads(for: selectedProject)
            }
        case .messageAppended, .threadStatus, .runStarted, .runFinished, .runFailed, .runEvent, .runOutput:
            if let selectedThread {
                await loadThread(selectedThread)
            }
            await loadSystemStatus()
        case .modelChanged:
            await loadModels()
        case .unknown:
            break
        }
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
