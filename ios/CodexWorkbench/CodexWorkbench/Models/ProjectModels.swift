import Foundation

struct ProjectSummary: Identifiable, Codable, Hashable, Sendable {
    var id: String { cwd }
    var name: String { label }
    var path: String? { cwd }
    var updatedAt: Date? { lastUpdatedAt }

    var cwd: String
    var label: String
    var lastUpdatedAt: Date
    var threadCount: Int
    var recentThreads: [ThreadSummary]

    private enum CodingKeys: String, CodingKey {
        case cwd
        case label
        case lastUpdatedAt
        case threadCount
        case recentThreads
    }

    init(
        cwd: String,
        label: String,
        lastUpdatedAt: Date,
        threadCount: Int = 0,
        recentThreads: [ThreadSummary] = []
    ) {
        self.cwd = cwd
        self.label = label
        self.lastUpdatedAt = lastUpdatedAt
        self.threadCount = threadCount
        self.recentThreads = recentThreads
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.cwd = try container.decode(String.self, forKey: .cwd)
        self.label = try container.decode(String.self, forKey: .label)
        self.lastUpdatedAt = try container.decode(Date.self, forKey: .lastUpdatedAt)
        self.threadCount = try container.decodeIfPresent(Int.self, forKey: .threadCount) ?? 0
        self.recentThreads = try container.decodeIfPresent([ThreadSummary].self, forKey: .recentThreads) ?? []
    }

    static let preview = ProjectSummary(
        cwd: "/Users/darklord/Documents/Codex",
        label: "Codex",
        lastUpdatedAt: Date(),
        threadCount: 1,
        recentThreads: []
    )
}

struct ThreadSummary: Identifiable, Codable, Hashable, Sendable {
    var projectId: String { cwd }
    var runState: ThreadRunState { ThreadRunState(threadId: id, phase: status) }

    var id: String
    var title: String
    var cwd: String
    var updatedAt: Date?
    var status: String
    var rolloutPath: String?
    var gitBranch: String
    var model: String?
    var effectiveModel: String?
    var parentThreadId: String?
    var isSubagent: Bool
    var agentNickname: String
    var agentRole: String
    var subagentDepth: Int?
    var subagents: [ThreadSummary]

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case cwd
        case updatedAt
        case status
        case rolloutPath
        case gitBranch
        case model
        case effectiveModel
        case parentThreadId
        case isSubagent
        case agentNickname
        case agentRole
        case subagentDepth
        case subagents
    }

    init(
        id: String,
        title: String,
        cwd: String,
        updatedAt: Date? = nil,
        status: String = "idle",
        rolloutPath: String? = nil,
        gitBranch: String = "",
        model: String? = nil,
        effectiveModel: String? = nil,
        parentThreadId: String? = nil,
        isSubagent: Bool = false,
        agentNickname: String = "",
        agentRole: String = "",
        subagentDepth: Int? = nil,
        subagents: [ThreadSummary] = []
    ) {
        self.id = id
        self.title = title
        self.cwd = cwd
        self.updatedAt = updatedAt
        self.status = status
        self.rolloutPath = rolloutPath
        self.gitBranch = gitBranch
        self.model = model
        self.effectiveModel = effectiveModel
        self.parentThreadId = parentThreadId
        self.isSubagent = isSubagent
        self.agentNickname = agentNickname
        self.agentRole = agentRole
        self.subagentDepth = subagentDepth
        self.subagents = subagents
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Untitled Conversation"
        self.cwd = try container.decodeIfPresent(String.self, forKey: .cwd) ?? ""
        self.updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        self.status = try container.decodeIfPresent(String.self, forKey: .status) ?? "idle"
        self.rolloutPath = try container.decodeIfPresent(String.self, forKey: .rolloutPath)
        self.gitBranch = try container.decodeIfPresent(String.self, forKey: .gitBranch) ?? ""
        self.model = try container.decodeIfPresent(String.self, forKey: .model)
        self.effectiveModel = try container.decodeIfPresent(String.self, forKey: .effectiveModel)
        self.parentThreadId = try container.decodeIfPresent(String.self, forKey: .parentThreadId)
        self.isSubagent = try container.decodeIfPresent(Bool.self, forKey: .isSubagent) ?? false
        self.agentNickname = try container.decodeIfPresent(String.self, forKey: .agentNickname) ?? ""
        self.agentRole = try container.decodeIfPresent(String.self, forKey: .agentRole) ?? ""
        self.subagentDepth = try container.decodeIfPresent(Int.self, forKey: .subagentDepth)
        self.subagents = try container.decodeIfPresent([ThreadSummary].self, forKey: .subagents) ?? []
    }

    static let preview = ThreadSummary(
        id: "preview-thread",
        title: "Native iOS client planning",
        cwd: "/Users/darklord/Documents/Codex",
        updatedAt: Date(),
        status: "idle",
        model: "gpt-5-codex"
    )
}

struct CreateThreadRequest: Codable, Equatable, Sendable {
    var cwd: String?

    init(cwd: String? = nil) {
        let trimmed = cwd?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.cwd = trimmed.isEmpty ? nil : trimmed
    }
}

struct CreateThreadResponse: Codable, Hashable, Sendable {
    var ok: Bool?
    var mode: String?
    var thread: ThreadSummary
    var response: JSONValue?
}

struct DesktopOpenResponse: Codable, Hashable, Sendable {
    var ok: Bool?
    var message: String?
    var error: String?
    var mode: String?
}

struct ThreadRunState: Codable, Hashable, Sendable {
    var threadId: String?
    var activeRunId: String?
    var turnId: String?
    var phase: String
    var canCancel: Bool
    var canRetry: Bool
    var transport: String?
    var updatedAt: Date?

    private enum CodingKeys: String, CodingKey {
        case threadId
        case activeRunId
        case turnId
        case phase
        case canCancel
        case canRetry
        case transport
        case updatedAt
    }

    var rawValue: String { phase }

    init(
        threadId: String? = nil,
        activeRunId: String? = nil,
        turnId: String? = nil,
        phase: String,
        canCancel: Bool = false,
        canRetry: Bool = false,
        transport: String? = nil,
        updatedAt: Date? = nil
    ) {
        self.threadId = threadId
        self.activeRunId = activeRunId
        self.turnId = turnId
        self.phase = phase
        self.canCancel = canCancel
        self.canRetry = canRetry
        self.transport = transport
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.threadId = try container.decodeIfPresent(String.self, forKey: .threadId)
        self.activeRunId = try container.decodeIfPresent(String.self, forKey: .activeRunId)
        self.turnId = try container.decodeIfPresent(String.self, forKey: .turnId)
        self.phase = try container.decodeIfPresent(String.self, forKey: .phase) ?? "idle"
        self.canCancel = try container.decodeIfPresent(Bool.self, forKey: .canCancel) ?? false
        self.canRetry = try container.decodeIfPresent(Bool.self, forKey: .canRetry) ?? false
        self.transport = try container.decodeIfPresent(String.self, forKey: .transport)
        self.updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(threadId, forKey: .threadId)
        try container.encodeIfPresent(activeRunId, forKey: .activeRunId)
        try container.encodeIfPresent(turnId, forKey: .turnId)
        try container.encode(phase, forKey: .phase)
        try container.encode(canCancel, forKey: .canCancel)
        try container.encode(canRetry, forKey: .canRetry)
        try container.encodeIfPresent(transport, forKey: .transport)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }

    static let idle = ThreadRunState(phase: "idle")
    static let queued = ThreadRunState(phase: "queued")
    static let running = ThreadRunState(phase: "running")
    static let starting = ThreadRunState(phase: "starting")
    static let cancelling = ThreadRunState(phase: "cancelling")
    static let failed = ThreadRunState(phase: "failed")
    static let completed = ThreadRunState(phase: "completed")
    static let cancelled = ThreadRunState(phase: "cancelled")

    static func == (lhs: ThreadRunState, rhs: ThreadRunState) -> Bool {
        lhs.phase == rhs.phase
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(phase)
    }

    static func fromSocketPayload(_ value: JSONValue?) -> ThreadRunState? {
        guard let object = value?.objectValue else {
            return nil
        }
        return ThreadRunState(
            threadId: object["threadId"]?.stringValue,
            activeRunId: object["activeRunId"]?.stringValue,
            turnId: object["turnId"]?.stringValue,
            phase: object["phase"]?.stringValue ?? "idle",
            canCancel: object["canCancel"]?.boolValue ?? false,
            canRetry: object["canRetry"]?.boolValue ?? false,
            transport: object["transport"]?.stringValue,
            updatedAt: object["updatedAt"]?.dateValue
        )
    }
}

struct ModelOption: Identifiable, Codable, Hashable, Sendable {
    var id: String
    var displayName: String
}

struct ModelInfo: Codable, Hashable, Sendable {
    var threadId: String?
    var model: String
    var availableModels: [String]?

    private enum CodingKeys: String, CodingKey {
        case threadId
        case model
        case availableModels
    }

    init(threadId: String? = nil, model: String = "", availableModels: [String]? = nil) {
        self.threadId = threadId
        self.model = model
        self.availableModels = availableModels
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.threadId = try container.decodeIfPresent(String.self, forKey: .threadId)
        self.model = try container.decodeIfPresent(String.self, forKey: .model) ?? ""
        self.availableModels = try container.decodeIfPresent([String].self, forKey: .availableModels)
    }

    var option: ModelOption {
        ModelOption(id: model, displayName: model)
    }

    var options: [ModelOption] {
        let models = availableModels?.isEmpty == false ? availableModels ?? [] : [model]
        return Array(NSOrderedSet(array: models).compactMap { $0 as? String })
            .filter { $0.isEmpty == false }
            .map { ModelOption(id: $0, displayName: $0) }
    }
}

struct RuntimeControls: Codable, Hashable, Sendable {
    var model: String
    var reasoningEffort: String
    var accessMode: String
    var planMode: Bool

    private enum CodingKeys: String, CodingKey {
        case model
        case reasoningEffort
        case effort
        case accessMode
        case planMode
    }

    init(
        model: String = "",
        reasoningEffort: String = "medium",
        accessMode: String = "on-request",
        planMode: Bool = false
    ) {
        self.model = model
        self.reasoningEffort = Self.normalizedReasoning(reasoningEffort)
        self.accessMode = Self.normalizedAccessMode(accessMode)
        self.planMode = planMode
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.model = try container.decodeIfPresent(String.self, forKey: .model) ?? ""
        self.reasoningEffort = Self.normalizedReasoning(
            try container.decodeIfPresent(String.self, forKey: .reasoningEffort)
                ?? container.decodeIfPresent(String.self, forKey: .effort)
                ?? "medium"
        )
        self.accessMode = Self.normalizedAccessMode(
            try container.decodeIfPresent(String.self, forKey: .accessMode) ?? "on-request"
        )
        self.planMode = try container.decodeFlexibleBoolIfPresent(forKey: .planMode) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(reasoningEffort, forKey: .reasoningEffort)
        try container.encode(accessMode, forKey: .accessMode)
        try container.encode(planMode, forKey: .planMode)
    }

    var displayModel: String {
        model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Default model" : model
    }

    func withModel(_ nextModel: String?) -> RuntimeControls {
        var next = self
        next.model = nextModel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? model
        return next
    }

    private static func normalizedReasoning(_ value: String) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["low", "medium", "high", "xhigh"].contains(normalized) ? normalized : "medium"
    }

    private static func normalizedAccessMode(_ value: String) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["read-only", "on-request", "full-access"].contains(normalized) ? normalized : "on-request"
    }
}

struct RuntimeControlSupport: Codable, Hashable, Sendable {
    var supported: Bool
    var transport: String?
    var values: [String]?
    var note: String?

    private enum CodingKeys: String, CodingKey {
        case supported
        case transport
        case values
        case note
    }

    init(supported: Bool = false, transport: String? = nil, values: [String]? = nil, note: String? = nil) {
        self.supported = supported
        self.transport = transport
        self.values = values
        self.note = note
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.supported = try container.decodeIfPresent(Bool.self, forKey: .supported) ?? false
        self.transport = try container.decodeIfPresent(String.self, forKey: .transport)
        self.values = try container.decodeIfPresent([String].self, forKey: .values)
        self.note = try container.decodeIfPresent(String.self, forKey: .note)
    }
}

struct RuntimeControlSupportSet: Codable, Hashable, Sendable {
    var model: RuntimeControlSupport
    var reasoningEffort: RuntimeControlSupport
    var accessMode: RuntimeControlSupport
    var planMode: RuntimeControlSupport
    var steerActiveRun: RuntimeControlSupport

    private enum CodingKeys: String, CodingKey {
        case model
        case reasoningEffort
        case accessMode
        case planMode
        case steerActiveRun
    }

    init(
        model: RuntimeControlSupport = RuntimeControlSupport(),
        reasoningEffort: RuntimeControlSupport = RuntimeControlSupport(),
        accessMode: RuntimeControlSupport = RuntimeControlSupport(),
        planMode: RuntimeControlSupport = RuntimeControlSupport(),
        steerActiveRun: RuntimeControlSupport = RuntimeControlSupport()
    ) {
        self.model = model
        self.reasoningEffort = reasoningEffort
        self.accessMode = accessMode
        self.planMode = planMode
        self.steerActiveRun = steerActiveRun
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.model = try container.decodeIfPresent(RuntimeControlSupport.self, forKey: .model) ?? RuntimeControlSupport()
        self.reasoningEffort = try container.decodeIfPresent(RuntimeControlSupport.self, forKey: .reasoningEffort) ?? RuntimeControlSupport()
        self.accessMode = try container.decodeIfPresent(RuntimeControlSupport.self, forKey: .accessMode) ?? RuntimeControlSupport()
        self.planMode = try container.decodeIfPresent(RuntimeControlSupport.self, forKey: .planMode) ?? RuntimeControlSupport()
        self.steerActiveRun = try container.decodeIfPresent(RuntimeControlSupport.self, forKey: .steerActiveRun) ?? RuntimeControlSupport()
    }
}

struct RuntimeCapabilities: Codable, Hashable, Sendable {
    var sendMode: String
    var controls: RuntimeControlSupportSet

    private enum CodingKeys: String, CodingKey {
        case sendMode
        case controls
    }

    init(sendMode: String = "desktop", controls: RuntimeControlSupportSet = RuntimeControlSupportSet()) {
        self.sendMode = sendMode
        self.controls = controls
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.sendMode = try container.decodeIfPresent(String.self, forKey: .sendMode) ?? "desktop"
        self.controls = try container.decodeIfPresent(RuntimeControlSupportSet.self, forKey: .controls) ?? RuntimeControlSupportSet()
    }
}

struct RuntimeAccessMode: Identifiable, Codable, Hashable, Sendable {
    var id: String { value }
    var value: String
    var label: String
    var approvalPolicy: String?
    var sandboxMode: String?
    var warning: String?

    private enum CodingKeys: String, CodingKey {
        case value
        case label
        case approvalPolicy
        case sandboxMode
        case warning
    }

    init(
        value: String,
        label: String? = nil,
        approvalPolicy: String? = nil,
        sandboxMode: String? = nil,
        warning: String? = nil
    ) {
        self.value = value
        self.label = label ?? value
        self.approvalPolicy = approvalPolicy
        self.sandboxMode = sandboxMode
        self.warning = warning
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.value = try container.decodeIfPresent(String.self, forKey: .value) ?? "on-request"
        self.label = try container.decodeIfPresent(String.self, forKey: .label) ?? value
        self.approvalPolicy = try container.decodeIfPresent(String.self, forKey: .approvalPolicy)
        self.sandboxMode = try container.decodeIfPresent(String.self, forKey: .sandboxMode)
        self.warning = try container.decodeIfPresent(String.self, forKey: .warning)
    }
}

struct RuntimeInfo: Codable, Hashable, Sendable {
    var defaults: RuntimeControls
    var thread: RuntimeControls?
    var capabilities: RuntimeCapabilities
    var accessModes: [RuntimeAccessMode]
    var reasoningEfforts: [String]

    private enum CodingKeys: String, CodingKey {
        case defaults
        case thread
        case capabilities
        case accessModes
        case reasoningEfforts
    }

    init(
        defaults: RuntimeControls = RuntimeControls(),
        thread: RuntimeControls? = nil,
        capabilities: RuntimeCapabilities = RuntimeCapabilities(),
        accessModes: [RuntimeAccessMode] = RuntimeInfo.defaultAccessModes,
        reasoningEfforts: [String] = ["low", "medium", "high", "xhigh"]
    ) {
        self.defaults = defaults
        self.thread = thread
        self.capabilities = capabilities
        self.accessModes = accessModes
        self.reasoningEfforts = reasoningEfforts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.defaults = try container.decodeIfPresent(RuntimeControls.self, forKey: .defaults) ?? RuntimeControls()
        self.thread = try container.decodeIfPresent(RuntimeControls.self, forKey: .thread)
        self.capabilities = try container.decodeIfPresent(RuntimeCapabilities.self, forKey: .capabilities) ?? RuntimeCapabilities()
        self.accessModes = try container.decodeIfPresent([RuntimeAccessMode].self, forKey: .accessModes) ?? Self.defaultAccessModes
        self.reasoningEfforts = try container.decodeIfPresent([String].self, forKey: .reasoningEfforts) ?? ["low", "medium", "high", "xhigh"]
    }

    var effectiveControls: RuntimeControls {
        thread ?? defaults
    }

    static let defaultAccessModes = [
        RuntimeAccessMode(value: "read-only", label: "Read-only"),
        RuntimeAccessMode(value: "on-request", label: "Ask before risky actions"),
        RuntimeAccessMode(value: "full-access", label: "Full access")
    ]
}

struct RuntimeControlsRequest: Codable, Hashable, Sendable {
    var controls: RuntimeControls
}

struct SystemStatus: Codable, Hashable, Sendable {
    var hostOnline: Bool
    var codexHome: String
    var stateDbReadable: Bool
    var sessionIndexReadable: Bool
    var activeRuns: Int
    var checkedAt: Date
    var sendMode: String?
    var model: String?
    var codexCli: JSONValue?
    var appServer: AppServerStatus?

    private enum CodingKeys: String, CodingKey {
        case hostOnline
        case codexHome
        case stateDbReadable
        case sessionIndexReadable
        case activeRuns
        case checkedAt
        case sendMode
        case model
        case codexCli
        case appServer
    }

    init(
        hostOnline: Bool = false,
        codexHome: String = "",
        stateDbReadable: Bool = false,
        sessionIndexReadable: Bool = false,
        activeRuns: Int = 0,
        checkedAt: Date = Date(),
        sendMode: String? = nil,
        model: String? = nil,
        codexCli: JSONValue? = nil,
        appServer: AppServerStatus? = nil
    ) {
        self.hostOnline = hostOnline
        self.codexHome = codexHome
        self.stateDbReadable = stateDbReadable
        self.sessionIndexReadable = sessionIndexReadable
        self.activeRuns = activeRuns
        self.checkedAt = checkedAt
        self.sendMode = sendMode
        self.model = model
        self.codexCli = codexCli
        self.appServer = appServer
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.hostOnline = try container.decodeIfPresent(Bool.self, forKey: .hostOnline) ?? true
        self.codexHome = try container.decodeIfPresent(String.self, forKey: .codexHome) ?? ""
        self.stateDbReadable = try container.decodeIfPresent(Bool.self, forKey: .stateDbReadable) ?? false
        self.sessionIndexReadable = try container.decodeIfPresent(Bool.self, forKey: .sessionIndexReadable) ?? false
        self.activeRuns = try container.decodeIfPresent(Int.self, forKey: .activeRuns) ?? 0
        self.checkedAt = try container.decodeIfPresent(Date.self, forKey: .checkedAt) ?? Date()
        self.sendMode = try container.decodeIfPresent(String.self, forKey: .sendMode)
        self.model = try container.decodeIfPresent(String.self, forKey: .model)
        self.codexCli = try container.decodeIfPresent(JSONValue.self, forKey: .codexCli)
        self.appServer = try container.decodeIfPresent(AppServerStatus.self, forKey: .appServer)
    }
}

struct AppServerStatus: Codable, Hashable, Sendable {
    var connected: Bool?
    var url: String?
}

private extension KeyedDecodingContainer {
    func decodeFlexibleBoolIfPresent(forKey key: Key) throws -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) {
            return value
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if ["true", "1", "yes", "on"].contains(normalized) {
                return true
            }
            if ["false", "0", "no", "off"].contains(normalized) {
                return false
            }
        }
        if let value = try? decodeIfPresent(Int.self, forKey: key) {
            return value != 0
        }
        return nil
    }
}

enum WorkbenchDateCoding {
    static let decodeDate: @Sendable (Decoder) throws -> Date = { decoder in
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        if let date = date(from: value) {
            return date
        }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO 8601 date: \(value)")
    }

    static func date(from value: String) -> Date? {
        fractionalISO8601.date(from: value) ?? plainISO8601.date(from: value)
    }

    private static let fractionalISO8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainISO8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
