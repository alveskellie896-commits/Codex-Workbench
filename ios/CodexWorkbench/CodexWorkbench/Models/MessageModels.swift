import Foundation

struct MessageEvent: Identifiable, Codable, Hashable, Sendable {
    var id: String
    var threadId: String
    var role: MessageRole
    var kind: MessageKind
    var text: String?
    var toolName: String?
    var toolStatus: String?
    var outputPreview: String?
    var activityType: String?
    var activityLabel: String?
    var createdAt: Date
    var attachmentIDs: [String]

    private enum CodingKeys: String, CodingKey {
        case id
        case threadId
        case role
        case kind
        case text
        case content
        case toolName
        case toolStatus
        case outputPreview
        case activityType
        case activityLabel
        case createdAt
        case attachmentIDs
        case attachmentIds
    }

    var content: String {
        text ?? outputPreview ?? activityLabel ?? ""
    }

    init(
        id: String,
        threadId: String,
        role: MessageRole,
        kind: MessageKind = .message,
        text: String? = nil,
        content: String? = nil,
        toolName: String? = nil,
        toolStatus: String? = nil,
        outputPreview: String? = nil,
        activityType: String? = nil,
        activityLabel: String? = nil,
        createdAt: Date,
        attachmentIDs: [String] = []
    ) {
        self.id = id
        self.threadId = threadId
        self.role = role
        self.kind = kind
        self.text = text ?? content
        self.toolName = toolName
        self.toolStatus = toolStatus
        self.outputPreview = outputPreview
        self.activityType = activityType
        self.activityLabel = activityLabel
        self.createdAt = createdAt
        self.attachmentIDs = attachmentIDs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.threadId = try container.decode(String.self, forKey: .threadId)
        self.role = try container.decode(MessageRole.self, forKey: .role)
        self.kind = try container.decodeIfPresent(MessageKind.self, forKey: .kind) ?? .message
        self.text = try container.decodeIfPresent(String.self, forKey: .text)
            ?? container.decodeIfPresent(String.self, forKey: .content)
        self.toolName = try container.decodeIfPresent(String.self, forKey: .toolName)
        self.toolStatus = try container.decodeIfPresent(String.self, forKey: .toolStatus)
        self.outputPreview = try container.decodeIfPresent(String.self, forKey: .outputPreview)
        self.activityType = try container.decodeIfPresent(String.self, forKey: .activityType)
        self.activityLabel = try container.decodeIfPresent(String.self, forKey: .activityLabel)
        self.createdAt = try container.decode(Date.self, forKey: .createdAt)
        self.attachmentIDs = try container.decodeIfPresent([String].self, forKey: .attachmentIDs)
            ?? container.decodeIfPresent([String].self, forKey: .attachmentIds)
            ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(threadId, forKey: .threadId)
        try container.encode(role, forKey: .role)
        try container.encode(kind, forKey: .kind)
        try container.encodeIfPresent(text, forKey: .text)
        try container.encodeIfPresent(toolName, forKey: .toolName)
        try container.encodeIfPresent(toolStatus, forKey: .toolStatus)
        try container.encodeIfPresent(outputPreview, forKey: .outputPreview)
        try container.encodeIfPresent(activityType, forKey: .activityType)
        try container.encodeIfPresent(activityLabel, forKey: .activityLabel)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(attachmentIDs, forKey: .attachmentIDs)
    }

    static let previewUser = MessageEvent(
        id: "preview-user-message",
        threadId: "preview-thread",
        role: .user,
        content: "Build the native SwiftUI client.",
        createdAt: Date()
    )

    static let previewAssistant = MessageEvent(
        id: "preview-assistant-message",
        threadId: "preview-thread",
        role: .assistant,
        content: "I will create the navigation, services, and models first.",
        createdAt: Date()
    )
}

enum MessageRole: String, Codable, Sendable {
    case system
    case user
    case assistant
    case tool
}

enum MessageKind: String, Codable, Sendable {
    case message
    case toolCall = "tool_call"
    case toolOutput = "tool_output"
    case runState = "run_state"
}

struct ThreadDetail: Codable, Equatable, Sendable {
    var thread: ThreadSummary
    var state: ThreadRunState?
    var messages: [MessageEvent]
    var incremental: Bool?
    var pageLimit: Int?
    var totalMessageCount: Int?
    var hasOlder: Bool?
    var hasNewer: Bool?
    var oldestLoadedMessageId: String?
    var newestLoadedMessageId: String?
    var followUps: [JSONValue]?
    var subagents: [ThreadSummary]?

    init(
        thread: ThreadSummary,
        state: ThreadRunState? = nil,
        messages: [MessageEvent] = [],
        incremental: Bool? = nil,
        pageLimit: Int? = nil,
        totalMessageCount: Int? = nil,
        hasOlder: Bool? = nil,
        hasNewer: Bool? = nil,
        oldestLoadedMessageId: String? = nil,
        newestLoadedMessageId: String? = nil,
        followUps: [JSONValue]? = nil,
        subagents: [ThreadSummary]? = nil
    ) {
        self.thread = thread
        self.state = state
        self.messages = messages
        self.incremental = incremental
        self.pageLimit = pageLimit
        self.totalMessageCount = totalMessageCount
        self.hasOlder = hasOlder
        self.hasNewer = hasNewer
        self.oldestLoadedMessageId = oldestLoadedMessageId
        self.newestLoadedMessageId = newestLoadedMessageId
        self.followUps = followUps
        self.subagents = subagents
    }
}

struct SendMessageRequest: Codable, Equatable, Sendable {
    var message: String
    var attachments: [UploadedFile]
    var queueIfRunning: Bool
    var runtime: RuntimeControls?

    init(
        message: String,
        attachments: [UploadedFile] = [],
        queueIfRunning: Bool = true,
        runtime: RuntimeControls? = nil
    ) {
        self.message = message
        self.attachments = attachments
        self.queueIfRunning = queueIfRunning
        self.runtime = runtime
    }
}

enum SendQueueStage: String, Codable, Hashable, Sendable {
    case queued
    case uploading
    case sending
    case submitted
    case followUpQueued = "follow_up_queued"
    case failed
}

struct SendQueueItem: Identifiable, Hashable, Sendable {
    var id = UUID()
    var threadId: String
    var text: String
    var attachments: [PendingAttachment]
    var runtime: RuntimeControls
    var stage: SendQueueStage
    var errorMessage: String?
    var followUpId: String?
    var createdAt = Date()

    var canRetry: Bool {
        stage == .failed
    }

    var canDismiss: Bool {
        stage == .failed || stage == .submitted || stage == .followUpQueued
    }
}

struct FollowUpItem: Identifiable, Codable, Hashable, Sendable {
    var id: String
    var threadId: String?
    var prompt: String
    var status: String
    var createdAt: Date?
    var updatedAt: Date?
    var controls: JSONValue?

    private enum CodingKeys: String, CodingKey {
        case id
        case threadId
        case prompt
        case status
        case createdAt
        case updatedAt
        case controls
    }

    init(
        id: String,
        threadId: String? = nil,
        prompt: String,
        status: String,
        createdAt: Date? = nil,
        updatedAt: Date? = nil,
        controls: JSONValue? = nil
    ) {
        self.id = id
        self.threadId = threadId
        self.prompt = prompt
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.controls = controls
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.threadId = try container.decodeIfPresent(String.self, forKey: .threadId)
        self.prompt = try container.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        self.status = try container.decodeIfPresent(String.self, forKey: .status) ?? "queued"
        self.createdAt = Self.decodeDate(container, key: .createdAt)
        self.updatedAt = Self.decodeDate(container, key: .updatedAt)
        self.controls = try container.decodeIfPresent(JSONValue.self, forKey: .controls)
    }

    private static func decodeDate(_ container: KeyedDecodingContainer<CodingKeys>, key: CodingKeys) -> Date? {
        guard let value = try? container.decodeIfPresent(String.self, forKey: key), value.isEmpty == false else {
            return nil
        }
        return WorkbenchDateCoding.date(from: value)
    }
}

struct FollowUpRequest: Codable, Equatable, Sendable {
    var message: String
    var runtime: RuntimeControls?

    init(message: String, runtime: RuntimeControls? = nil) {
        self.message = message
        self.runtime = runtime
    }
}

struct FollowUpResponse: Codable, Hashable, Sendable {
    var followUp: FollowUpItem?
    var followUps: [FollowUpItem]?
    var state: ThreadRunState?
    var steerActiveRun: Bool?
}

struct UploadRequestFile: Codable, Hashable, Sendable {
    var threadId: String?
    var name: String
    var type: String
    var dataBase64: String

    init(name: String, type: String, dataBase64: String, threadId: String? = nil) {
        self.threadId = threadId
        self.name = name
        self.type = type
        self.dataBase64 = dataBase64
    }
}

struct UploadedFile: Codable, Hashable, Sendable {
    var name: String
    var type: String
    var size: Int
    var path: String
}

struct UploadResponse: Codable, Hashable, Sendable {
    var uploads: [UploadedFile]
}

struct AttachmentUploadResponse: Codable, Equatable, Sendable {
    var id: String
    var fileName: String
    var contentType: String
}

enum PendingAttachmentStatus: String, Hashable, Sendable {
    case ready
    case uploading
    case uploaded
    case failed
}

struct PendingAttachment: Identifiable, Hashable, Sendable {
    var id = UUID()
    var name: String
    var contentType: String
    var size: Int
    var data: Data
    var status: PendingAttachmentStatus
    var uploadedFile: UploadedFile?
    var errorMessage: String?

    var canSend: Bool {
        status == .ready || status == .uploaded
    }

    var isBusy: Bool {
        status == .uploading
    }
}

struct CancelResponse: Codable, Hashable, Sendable {
    var cancelled: Bool
    var state: ThreadRunState
}

enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let value) = self {
            return value
        }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let value) = self {
            return value
        }
        return nil
    }

    var dateValue: Date? {
        guard let stringValue else {
            return nil
        }
        return WorkbenchDateCoding.date(from: stringValue)
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self {
            return value
        }
        return nil
    }

    subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }
}

enum WorkbenchSocketEventType: String, Codable, Sendable {
    case systemConnected = "system.connected"
    case projectUpdated = "project.updated"
    case threadUpdated = "thread.updated"
    case threadStatus = "thread.status"
    case messageAppended = "message.appended"
    case runStarted = "run.started"
    case runFinished = "run.finished"
    case runFailed = "run.failed"
    case runEvent = "run.event"
    case runOutput = "run.output"
    case modelChanged = "model.changed"
    case followUpQueued = "followup.queued"
    case followUpUpdated = "followup.updated"
    case followUpCancelled = "followup.cancelled"
    case followUpReordered = "followup.reordered"
    case runtimeChanged = "runtime.changed"
    case securityDeviceRevoked = "security.device-revoked"
    case unknown
}

struct WorkbenchSocketEvent: Codable, Hashable, Sendable {
    var type: WorkbenchSocketEventType
    var payload: JSONValue?
    var at: Date?
    var rawType: String

    private enum CodingKeys: String, CodingKey {
        case type
        case payload
        case at
    }

    init(type: WorkbenchSocketEventType, payload: JSONValue? = nil, at: Date? = nil, rawType: String? = nil) {
        self.type = type
        self.payload = payload
        self.at = at
        self.rawType = rawType ?? type.rawValue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rawType = try container.decode(String.self, forKey: .type)
        self.type = WorkbenchSocketEventType(rawValue: rawType) ?? .unknown
        self.rawType = rawType
        self.payload = try container.decodeIfPresent(JSONValue.self, forKey: .payload)
        self.at = try container.decodeIfPresent(Date.self, forKey: .at)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(rawType, forKey: .type)
        try container.encodeIfPresent(payload, forKey: .payload)
        try container.encodeIfPresent(at, forKey: .at)
    }

    var threadID: String? {
        payloadString("threadId") ?? payload?["thread"]?["id"]?.stringValue
    }

    var projectCwd: String? {
        payloadString("cwd") ?? payload?["project"]?["cwd"]?.stringValue
    }

    var model: String? {
        payloadString("model")
    }

    var runErrorMessage: String? {
        payloadString("error") ?? payloadString("lastError") ?? payload?["state"]?["lastError"]?.stringValue
    }

    var statePayload: JSONValue? {
        if type == .threadStatus {
            return payload?["state"] ?? payload
        }
        return payload?["state"]
    }

    private func payloadString(_ key: String) -> String? {
        payload?[key]?.stringValue
    }
}
