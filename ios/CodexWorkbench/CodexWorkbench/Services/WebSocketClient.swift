import Foundation

enum WebSocketConnectionState: Equatable, Sendable {
    case offline
    case connecting
    case online
}

final class WebSocketClient {
    private let hostStore: HostURLStore
    private let tokenStore: TokenStore
    private let decoder: JSONDecoder
    private var task: URLSessionWebSocketTask?
    private let session: URLSession

    private(set) var connectionState: WebSocketConnectionState = .offline

    init(hostStore: HostURLStore, tokenStore: TokenStore, session: URLSession = .shared) {
        self.hostStore = hostStore
        self.tokenStore = tokenStore
        self.session = session

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(WorkbenchDateCoding.decodeDate)
        self.decoder = decoder
    }

    func connect() throws -> AsyncThrowingStream<WorkbenchSocketEvent, Error> {
        disconnect()
        let request = try makeRequest()
        let task = session.webSocketTask(with: request)
        self.task = task
        connectionState = .connecting
        task.resume()
        connectionState = .online

        return AsyncThrowingStream { continuation in
            continuation.onTermination = { _ in
                task.cancel(with: .goingAway, reason: nil)
            }
            Task {
                do {
                    while Task.isCancelled == false {
                        let message = try await task.receive()
                        if let event = try self.decode(message) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    self.connectionState = .offline
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    func connect(threadID: String) throws -> AsyncThrowingStream<WorkbenchSocketEvent, Error> {
        try connect()
    }

    func eventsWithReconnect(
        maxAttempts: Int = 6,
        baseDelayNanoseconds: UInt64 = 800_000_000
    ) -> AsyncThrowingStream<WorkbenchSocketEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var attempts = 0
                while Task.isCancelled == false {
                    do {
                        let stream = try connect()
                        attempts = 0
                        for try await event in stream {
                            continuation.yield(event)
                        }
                    } catch {
                        connectionState = .offline
                        attempts += 1
                        if attempts > maxAttempts {
                            continuation.finish(throwing: error)
                            return
                        }
                        let multiplier = UInt64(1 << min(attempts - 1, 4))
                        try? await Task.sleep(nanoseconds: baseDelayNanoseconds * multiplier)
                    }
                }
                continuation.finish()
            }

            continuation.onTermination = { _ in
                task.cancel()
                self.disconnect()
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectionState = .offline
    }

    private func makeRequest() throws -> URLRequest {
        guard let session = tokenStore.loadSession(), session.isExpired == false else {
            throw APIClientError.unauthorized
        }
        guard var components = URLComponents(url: hostStore.hostURL, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidURL("/ws")
        }

        switch components.scheme {
        case "https":
            components.scheme = "wss"
        case "http":
            components.scheme = "ws"
        default:
            throw APIClientError.invalidURL("/ws")
        }

        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + [basePath, "ws"].filter { $0.isEmpty == false }.joined(separator: "/")
        components.queryItems = [URLQueryItem(name: "token", value: session.accessToken)]

        guard let url = components.url else {
            throw APIClientError.invalidURL("/ws")
        }

        return URLRequest(url: url)
    }

    private func decode(_ message: URLSessionWebSocketTask.Message) throws -> WorkbenchSocketEvent? {
        let data: Data
        switch message {
        case .data(let value):
            data = value
        case .string(let string):
            data = Data(string.utf8)
        @unknown default:
            return nil
        }
        return try decoder.decode(WorkbenchSocketEvent.self, from: data)
    }
}
