import Foundation

struct AuthSession: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String?
    var expiresAt: Date?
    var deviceId: String?
    var authMethod: String?
    var trustLevel: String?

    var isExpired: Bool {
        guard let expiresAt else {
            return false
        }
        return expiresAt <= Date()
    }
}

struct LoginRequest: Codable, Equatable, Sendable {
    var password: String
}

struct LoginResponse: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String?
    var expiresIn: Int?
    var expiresAt: Date?
    var deviceId: String?
    var authMethod: String?
    var trustLevel: String?

    var session: AuthSession {
        AuthSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt ?? expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) },
            deviceId: deviceId,
            authMethod: authMethod,
            trustLevel: trustLevel
        )
    }
}

typealias AuthTokenPair = LoginResponse

struct TrustedDevice: Identifiable, Codable, Hashable, Sendable {
    var id: String
    var name: String
    var createdAt: String?
    var lastSeenAt: String?
    var revokedAt: String?
    var permissionLevel: String?
    var fingerprintDigest: String?
    var userAgent: String?

    var isRevoked: Bool {
        revokedAt?.isEmpty == false
    }
}

struct TrustedDeviceCredential: Codable, Equatable, Sendable {
    var deviceId: String
    var deviceToken: String
    var name: String
    var permissionLevel: String
    var pairedAt: Date
}

struct DeviceLoginResponse: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String?
    var expiresIn: Int?
    var expiresAt: Date?
    var deviceId: String?
    var authMethod: String?
    var trustLevel: String?
    var device: TrustedDevice?

    var session: AuthSession {
        AuthSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt ?? expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) },
            deviceId: deviceId,
            authMethod: authMethod,
            trustLevel: trustLevel
        )
    }
}

struct PairingCompleteResponse: Codable, Equatable, Sendable {
    var device: TrustedDevice
    var deviceToken: String
    var tokens: LoginResponse

    var session: AuthSession {
        tokens.session
    }

    var trustedCredential: TrustedDeviceCredential {
        TrustedDeviceCredential(
            deviceId: device.id,
            deviceToken: deviceToken,
            name: device.name,
            permissionLevel: device.permissionLevel ?? "phone",
            pairedAt: Date()
        )
    }
}

struct DeviceListResponse: Codable, Equatable, Sendable {
    var devices: [TrustedDevice]
}

struct DeviceResponse: Codable, Equatable, Sendable {
    var device: TrustedDevice
}

struct PairingCompleteRequest: Codable, Equatable, Sendable {
    var code: String
    var deviceName: String
    var fingerprint: String
}

struct DeviceLoginRequest: Codable, Equatable, Sendable {
    var deviceId: String
    var deviceToken: String
    var fingerprint: String
}

struct DeviceMutationRequest: Codable, Equatable, Sendable {
    var deviceId: String
    var name: String?

    init(deviceId: String, name: String? = nil) {
        self.deviceId = deviceId
        self.name = name
    }
}

struct AuthStatus: Codable, Equatable, Sendable {
    var configured: Bool
    var setupRequired: Bool
    var source: String

    private enum CodingKeys: String, CodingKey {
        case configured
        case setupRequired
        case source
    }

    init(configured: Bool, setupRequired: Bool, source: String) {
        self.configured = configured
        self.setupRequired = setupRequired
        self.source = source
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.configured = try container.decodeIfPresent(Bool.self, forKey: .configured) ?? false
        self.setupRequired = try container.decodeIfPresent(Bool.self, forKey: .setupRequired) ?? false
        self.source = try container.decodeIfPresent(String.self, forKey: .source) ?? ""
    }
}

struct ChangePasswordRequest: Codable, Equatable, Sendable {
    var currentPassword: String
    var newPassword: String
}

struct RefreshTokenRequest: Codable, Equatable, Sendable {
    var refreshToken: String
}

struct MobileBootstrap: Codable, Hashable, Sendable {
    var apiVersion: Int
    var platformTarget: String
    var service: MobileServiceInfo
    var auth: MobileAuthInfo
    var endpoints: MobileEndpointInfo
    var capabilities: MobileCapabilities
    var limits: MobileLimits
    var runtime: JSONValue?
    var model: ModelInfo?
    var publicLink: MobilePublicLink?
}

struct MobileServiceInfo: Codable, Hashable, Sendable {
    var name: String
    var pwaVersion: String?
    var buildId: String?
    var serverTime: Date?
    var host: String?
    var port: Int?
    var sendMode: String?
}

struct MobileAuthInfo: Codable, Hashable, Sendable {
    var setupRequired: Bool
    var authenticated: Bool
    var authMethod: String?
    var trustLevel: String?
    var deviceId: String?
    var accessTokenTtlSeconds: Int?
    var refreshTokenTtlSeconds: Int?
    var supported: [String]?
}

struct MobileEndpointInfo: Codable, Hashable, Sendable {
    var basePath: String?
    var bootstrap: String?
    var webSocket: String?
    var authStatus: String?
    var login: String?
    var refresh: String?
    var deviceLogin: String?
    var pairingSession: String?
    var pairingComplete: String?
    var projects: String?
    var threads: String?
    var thread: String?
    var threadDetail: String?
    var send: String?
    var uploads: String?
    var followUps: String?
    var systemStatus: String?
    var diagnostics: String?
    var runtimeDefaults: String?
    var model: String?
}

struct MobileCapabilities: Codable, Hashable, Sendable {
    var projects: Bool?
    var threadList: Bool?
    var threadDetailPaging: Bool?
    var sendMessage: Bool?
    var localSendQueueRecommended: Bool?
    var followUps: Bool?
    var fileUploads: Bool?
    var trustedPairing: Bool?
    var deviceRevocation: Bool?
    var webSocketEvents: Bool?
    var diagnostics: Bool?
    var runtimeControls: Bool?
    var modelSelection: Bool?
    var git: Bool?
    var subagents: Bool?
    var browserFallbackSupported: Bool?
    var nativePush: Bool?
}

struct MobileLimits: Codable, Hashable, Sendable {
    var threadDetailDefaultLimit: Int?
    var upload: MobileUploadLimits?
}

struct MobileUploadLimits: Codable, Hashable, Sendable {
    var maxFileBytes: Int?
    var maxBatchBytes: Int?
    var maxJsonBodyBytes: Int?
}

struct MobilePublicLink: Codable, Hashable, Sendable {
    var phoneUrl: String?
    var computerUrl: String?
    var tunnelType: String?
    var stable: Bool?
    var failureReason: String?
}
