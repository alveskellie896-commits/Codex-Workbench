import Foundation

struct APIClient {
    private let hostStore: HostURLStore
    private let tokenStore: TokenStore
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        hostStore: HostURLStore,
        tokenStore: TokenStore,
        session: URLSession = .shared
    ) {
        self.hostStore = hostStore
        self.tokenStore = tokenStore
        self.session = session

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(WorkbenchDateCoding.decodeDate)
        self.decoder = decoder

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    func authStatus() async throws -> AuthStatus {
        try await request(path: "/api/auth/status", requiresAuth: false)
    }

    func mobileBootstrap() async throws -> MobileBootstrap {
        try await request(path: "/api/mobile/v1/bootstrap", requiresAuth: false, includeAuthIfAvailable: true)
    }

    func setupPassword(_ password: String) async throws -> AuthSession {
        let response: LoginResponse = try await request(
            path: "/api/auth/setup",
            method: "POST",
            body: LoginRequest(password: password),
            requiresAuth: false
        )
        tokenStore.saveSession(response.session)
        return response.session
    }

    func login(password: String) async throws -> AuthSession {
        let response: LoginResponse = try await request(
            path: "/api/auth/login",
            method: "POST",
            body: LoginRequest(password: password),
            requiresAuth: false
        )
        tokenStore.saveSession(response.session)
        return response.session
    }

    func deviceLogin(credential: TrustedDeviceCredential, fingerprint: String) async throws -> DeviceLoginResponse {
        let response: DeviceLoginResponse = try await request(
            path: "/api/auth/device-login",
            method: "POST",
            body: DeviceLoginRequest(
                deviceId: credential.deviceId,
                deviceToken: credential.deviceToken,
                fingerprint: fingerprint
            ),
            requiresAuth: false
        )
        tokenStore.saveSession(response.session)
        return response
    }

    func completePairing(code: String, deviceName: String, fingerprint: String) async throws -> PairingCompleteResponse {
        let response: PairingCompleteResponse = try await request(
            path: "/api/pairing/complete",
            method: "POST",
            body: PairingCompleteRequest(code: code, deviceName: deviceName, fingerprint: fingerprint),
            requiresAuth: false
        )
        tokenStore.saveTrustedDevice(response.trustedCredential)
        tokenStore.saveSession(response.session)
        return response
    }

    func fetchTrustedDevices() async throws -> [TrustedDevice] {
        let response: DeviceListResponse = try await request(path: "/api/devices")
        return response.devices
    }

    func renameTrustedDevice(deviceID: String, name: String) async throws -> TrustedDevice {
        let response: DeviceResponse = try await request(
            path: "/api/devices",
            method: "PATCH",
            body: DeviceMutationRequest(deviceId: deviceID, name: name)
        )
        return response.device
    }

    func revokeTrustedDevice(deviceID: String) async throws -> TrustedDevice {
        let response: DeviceResponse = try await request(
            path: "/api/devices",
            method: "DELETE",
            body: DeviceMutationRequest(deviceId: deviceID)
        )
        return response.device
    }

    func refresh() async throws -> AuthSession {
        guard let refreshToken = tokenStore.loadSession()?.refreshToken else {
            throw APIClientError.unauthorized
        }
        let response: LoginResponse = try await request(
            path: "/api/auth/refresh",
            method: "POST",
            body: RefreshTokenRequest(refreshToken: refreshToken),
            requiresAuth: false
        )
        let session = AuthSession(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken ?? refreshToken,
            expiresAt: response.session.expiresAt,
            deviceId: response.deviceId,
            authMethod: response.authMethod,
            trustLevel: response.trustLevel
        )
        tokenStore.saveSession(session)
        return session
    }

    func changePassword(currentPassword: String, newPassword: String) async throws -> AuthSession {
        let response: LoginResponse = try await request(
            path: "/api/auth/password",
            method: "POST",
            body: ChangePasswordRequest(currentPassword: currentPassword, newPassword: newPassword)
        )
        tokenStore.saveSession(response.session)
        return response.session
    }

    func fetchProjects() async throws -> [ProjectSummary] {
        try await request(path: "/api/projects")
    }

    func fetchThreads(projectID: String) async throws -> [ThreadSummary] {
        try await request(path: "/api/threads", queryItems: [URLQueryItem(name: "project", value: projectID)])
    }

    func createThread(projectID: String? = nil) async throws -> ThreadSummary {
        let response: CreateThreadResponse = try await request(
            path: "/api/threads/new",
            method: "POST",
            body: CreateThreadRequest(cwd: projectID)
        )
        return response.thread
    }

    func fetchThread(threadID: String) async throws -> ThreadDetail {
        try await fetchThreadDetail(threadID: threadID)
    }

    func fetchThreadDetail(
        threadID: String,
        afterMessageID: String? = nil,
        beforeMessageID: String? = nil,
        limit: Int? = nil
    ) async throws -> ThreadDetail {
        var queryItems: [URLQueryItem] = []
        if let afterMessageID, afterMessageID.isEmpty == false {
            queryItems.append(URLQueryItem(name: "after", value: afterMessageID))
        }
        if let beforeMessageID, beforeMessageID.isEmpty == false {
            queryItems.append(URLQueryItem(name: "before", value: beforeMessageID))
        }
        if let limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        return try await request(path: "/api/threads/\(threadID.urlPathEncoded)/detail", queryItems: queryItems)
    }

    func fetchMessages(threadID: String) async throws -> [MessageEvent] {
        try await request(path: "/api/threads/\(threadID.urlPathEncoded)/messages")
    }

    func fetchModels() async throws -> [ModelOption] {
        try await model().options
    }

    func model() async throws -> ModelInfo {
        try await request(path: "/api/system/model")
    }

    func setModel(_ model: String) async throws -> ModelInfo {
        try await request(
            path: "/api/system/model",
            method: "POST",
            body: ModelRequest(model: model)
        )
    }

    func threadModel(threadID: String) async throws -> ModelInfo {
        try await request(path: "/api/threads/\(threadID.urlPathEncoded)/model")
    }

    func setThreadModel(threadID: String, model: String) async throws -> ModelInfo {
        try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/model",
            method: "POST",
            body: ModelRequest(model: model)
        )
    }

    func runtimeDefaults() async throws -> RuntimeInfo {
        try await request(path: "/api/runtime/defaults")
    }

    func setRuntimeDefaults(_ controls: RuntimeControls) async throws -> RuntimeInfo {
        try await request(
            path: "/api/runtime/defaults",
            method: "POST",
            body: RuntimeControlsRequest(controls: controls)
        )
    }

    func threadRuntime(threadID: String) async throws -> RuntimeInfo {
        try await request(path: "/api/threads/\(threadID.urlPathEncoded)/runtime")
    }

    func setThreadRuntime(threadID: String, controls: RuntimeControls) async throws -> RuntimeInfo {
        try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/runtime",
            method: "POST",
            body: RuntimeControlsRequest(controls: controls)
        )
    }

    func systemStatus() async throws -> SystemStatus {
        try await request(path: "/api/system/status")
    }

    func sendMessage(
        threadID: String,
        content: String,
        model: String?,
        attachments: [UploadedFile] = [],
        runtime: RuntimeControls? = nil
    ) async throws -> ThreadDetail {
        let controls = runtime ?? RuntimeControls(model: model ?? "")
        _ = try await setThreadRuntime(threadID: threadID, controls: controls)
        _ = try await send(threadID: threadID, message: content, attachments: attachments, runtime: controls)
        return try await fetchThread(threadID: threadID)
    }

    func sendMessage(
        threadID: String,
        content: String,
        model: String?,
        attachmentIDs: [String]
    ) async throws -> ThreadDetail {
        _ = attachmentIDs
        return try await sendMessage(threadID: threadID, content: content, model: model, attachments: [])
    }

    func send(
        threadID: String,
        message: String,
        attachments: [UploadedFile] = [],
        runtime: RuntimeControls? = nil
    ) async throws -> ThreadRunState {
        try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/send",
            method: "POST",
            body: SendMessageRequest(message: message, attachments: attachments, runtime: runtime)
        )
    }

    func fetchFollowUps(threadID: String) async throws -> FollowUpResponse {
        try await request(path: "/api/threads/\(threadID.urlPathEncoded)/followups")
    }

    func enqueueFollowUp(threadID: String, message: String, runtime: RuntimeControls? = nil) async throws -> FollowUpResponse {
        try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/followups",
            method: "POST",
            body: FollowUpRequest(message: message, runtime: runtime)
        )
    }

    func cancelFollowUp(threadID: String, followUpID: String) async throws -> FollowUpResponse {
        try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/followups/\(followUpID.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func cancelRun(threadID: String) async throws {
        let _: CancelResponse = try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/cancel",
            method: "POST"
        )
    }

    func retry(threadID: String) async throws -> ThreadDetail {
        let _: ThreadRunState = try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/retry",
            method: "POST"
        )
        return try await fetchThread(threadID: threadID)
    }

    func openDesktopThread(threadID: String) async throws -> DesktopOpenResponse {
        try await request(
            path: "/api/threads/\(threadID.urlPathEncoded)/open-desktop",
            method: "POST"
        )
    }

    func upload(files: [UploadRequestFile]) async throws -> UploadResponse {
        try await request(path: "/api/uploads", method: "POST", body: UploadFilesRequest(files: files))
    }

    func uploadAttachment(
        threadID: String,
        fileName: String,
        contentType: String,
        data: Data
    ) async throws -> UploadedFile {
        let file = UploadRequestFile(
            name: fileName,
            type: contentType,
            dataBase64: data.base64EncodedString(),
            threadId: threadID
        )
        let response = try await upload(files: [file])
        guard let upload = response.uploads.first else {
            throw APIClientError.invalidResponse
        }
        return upload
    }

    func uploadAttachment(
        fileName: String,
        contentType: String,
        data: Data
    ) async throws -> AttachmentUploadResponse {
        let upload = try await uploadAttachment(threadID: "", fileName: fileName, contentType: contentType, data: data)
        return AttachmentUploadResponse(id: upload.path, fileName: upload.name, contentType: upload.type)
    }

    private func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        queryItems: [URLQueryItem] = [],
        requiresAuth: Bool = true,
        includeAuthIfAvailable: Bool = false,
        allowRefresh: Bool = true
    ) async throws -> Response {
        let request = try makeRequest(
            path: path,
            method: method,
            queryItems: queryItems,
            body: nil,
            requiresAuth: requiresAuth,
            includeAuthIfAvailable: includeAuthIfAvailable
        )
        return try await perform(request, retrying: {
            try await self.request(
                path: path,
                method: method,
                queryItems: queryItems,
                requiresAuth: requiresAuth,
                includeAuthIfAvailable: includeAuthIfAvailable,
                allowRefresh: false
            ) as Response
        }, allowRefresh: allowRefresh && requiresAuth)
    }

    private func request<RequestBody: Encodable, Response: Decodable>(
        path: String,
        method: String,
        body: RequestBody,
        queryItems: [URLQueryItem] = [],
        requiresAuth: Bool = true,
        includeAuthIfAvailable: Bool = false,
        allowRefresh: Bool = true
    ) async throws -> Response {
        let bodyData = try encoder.encode(body)
        let request = try makeRequest(
            path: path,
            method: method,
            queryItems: queryItems,
            body: bodyData,
            requiresAuth: requiresAuth,
            includeAuthIfAvailable: includeAuthIfAvailable
        )
        return try await perform(request, retrying: {
            try await self.request(
                path: path,
                method: method,
                body: body,
                queryItems: queryItems,
                requiresAuth: requiresAuth,
                includeAuthIfAvailable: includeAuthIfAvailable,
                allowRefresh: false
            ) as Response
        }, allowRefresh: allowRefresh && requiresAuth)
    }

    private func perform<Response: Decodable>(
        _ request: URLRequest,
        retrying retry: () async throws -> Response,
        allowRefresh: Bool
    ) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if httpResponse.statusCode == 401, allowRefresh {
            do {
                _ = try await refresh()
                return try await retry()
            } catch {
                tokenStore.saveSession(nil)
                throw APIClientError.unauthorized
            }
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                tokenStore.saveSession(nil)
                throw APIClientError.unauthorized
            }
            throw APIClientError.server(statusCode: httpResponse.statusCode, message: decodeErrorMessage(from: data))
        }

        if Response.self == EmptyResponse.self {
            return EmptyResponse() as! Response
        }
        return try decoder.decode(Response.self, from: data)
    }

    private func makeRequest(
        path: String,
        method: String,
        queryItems: [URLQueryItem],
        body: Data?,
        requiresAuth: Bool,
        includeAuthIfAvailable: Bool
    ) throws -> URLRequest {
        guard var components = URLComponents(url: hostStore.hostURL, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidURL(path)
        }

        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let requestPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + [basePath, requestPath].filter { $0.isEmpty == false }.joined(separator: "/")
        components.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let url = components.url else {
            throw APIClientError.invalidURL(path)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if (requiresAuth || includeAuthIfAvailable), let session = tokenStore.loadSession(), session.isExpired == false {
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func decodeErrorMessage(from data: Data) -> String? {
        guard data.isEmpty == false else { return nil }
        if let payload = try? decoder.decode(ErrorPayload.self, from: data) {
            return payload.error ?? payload.message
        }
        return String(data: data, encoding: .utf8)
    }
}

enum APIClientError: LocalizedError, Equatable {
    case invalidURL(String)
    case invalidResponse
    case unauthorized
    case server(statusCode: Int, message: String?)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            "Could not build API URL for \(path)."
        case .invalidResponse:
            "The host service returned an invalid response."
        case .unauthorized:
            "Session expired. Please sign in again."
        case .server(let statusCode, let message):
            message ?? "The host service returned HTTP \(statusCode)."
        case .transport(let message):
            message
        }
    }
}

private struct EmptyResponse: Decodable {}

private struct ErrorPayload: Decodable {
    var error: String?
    var message: String?
}

private struct ModelRequest: Encodable {
    var model: String
}

private struct UploadFilesRequest: Encodable {
    var files: [UploadRequestFile]
}

private extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?"))) ?? self
    }
}
