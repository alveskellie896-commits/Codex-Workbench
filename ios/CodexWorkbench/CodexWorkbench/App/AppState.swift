import Foundation
import Observation

@MainActor
@Observable
final class AppState {
    var selectedProject: ProjectSummary?
    var selectedThread: ThreadSummary?
    var session: AuthSession?
    var authStatus: AuthStatus?
    var projects: [ProjectSummary] = []
    var threadsByProject: [String: [ThreadSummary]] = [:]
    var messagesByThread: [String: [MessageEvent]] = [:]
    var runStatesByThread: [String: ThreadRunState] = [:]
    var availableModels: [ModelOption] = []
    var systemStatus: SystemStatus?
    var isLoadingProjects = false
    var loadingProjectIDs: Set<String> = []
    var loadingThreadIDs: Set<String> = []
    var errorMessage: String?
    var connectionState: WebSocketConnectionState = .offline

    let hostStore: HostURLStore
    let tokenStore: TokenStore
    let apiClient: APIClient
    let webSocketClient: WebSocketClient

    private var realtimeTask: Task<Void, Never>?

    init(
        hostStore: HostURLStore,
        tokenStore: TokenStore,
        apiClient: APIClient,
        webSocketClient: WebSocketClient
    ) {
        self.hostStore = hostStore
        self.tokenStore = tokenStore
        self.apiClient = apiClient
        self.webSocketClient = webSocketClient
        self.session = tokenStore.loadSession()

        if session != nil {
            startRealtime()
        }
    }

    static func bootstrap() -> AppState {
        let hostStore = HostURLStore()
        let tokenStore = KeychainTokenStore()
        let apiClient = APIClient(hostStore: hostStore, tokenStore: tokenStore)
        let webSocketClient = WebSocketClient(hostStore: hostStore, tokenStore: tokenStore)

        return AppState(
            hostStore: hostStore,
            tokenStore: tokenStore,
            apiClient: apiClient,
            webSocketClient: webSocketClient
        )
    }

    func bootstrapSession() async {
        guard session != nil else {
            await loadAuthStatus()
            return
        }
        await refreshAll()
        startRealtime()
    }

    func loadAuthStatus() async {
        do {
            authStatus = try await apiClient.authStatus()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func login(password: String) async {
        do {
            updateSession(try await apiClient.login(password: password))
            await refreshAll()
            startRealtime()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setupPassword(_ password: String) async {
        do {
            updateSession(try await apiClient.setupPassword(password))
            authStatus = AuthStatus(configured: true, setupRequired: false, source: "local")
            await refreshAll()
            startRealtime()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

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
}
