import Foundation
import Security

protocol TokenStore {
    func loadSession() -> AuthSession?
    func saveSession(_ session: AuthSession?)
    func loadTrustedDevice() -> TrustedDeviceCredential?
    func saveTrustedDevice(_ credential: TrustedDeviceCredential?)
}

final class UserDefaultsTokenStore: TokenStore {
    private let userDefaults: UserDefaults
    private let key: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(
        userDefaults: UserDefaults = .standard,
        key: String = "codexWorkbench.authSession"
    ) {
        self.userDefaults = userDefaults
        self.key = key
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    func loadSession() -> AuthSession? {
        guard let data = userDefaults.data(forKey: key) else {
            return nil
        }
        return try? decoder.decode(AuthSession.self, from: data)
    }

    func saveSession(_ session: AuthSession?) {
        guard let session else {
            userDefaults.removeObject(forKey: key)
            return
        }
        guard let data = try? encoder.encode(session) else {
            return
        }
        userDefaults.set(data, forKey: key)
    }

    func loadTrustedDevice() -> TrustedDeviceCredential? {
        guard let data = userDefaults.data(forKey: "\(key).trustedDevice") else {
            return nil
        }
        return try? decoder.decode(TrustedDeviceCredential.self, from: data)
    }

    func saveTrustedDevice(_ credential: TrustedDeviceCredential?) {
        let trustedKey = "\(key).trustedDevice"
        guard let credential else {
            userDefaults.removeObject(forKey: trustedKey)
            return
        }
        guard let data = try? encoder.encode(credential) else {
            return
        }
        userDefaults.set(data, forKey: trustedKey)
    }
}

final class KeychainTokenStore: TokenStore {
    private let service = "com.codexworkbench.ios.auth"
    private let sessionAccount = "session"
    private let trustedDeviceAccount = "trusted-device"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init() {
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    func loadSession() -> AuthSession? {
        loadValue(AuthSession.self, account: sessionAccount)
    }

    func saveSession(_ session: AuthSession?) {
        saveValue(session, account: sessionAccount)
    }

    func loadTrustedDevice() -> TrustedDeviceCredential? {
        loadValue(TrustedDeviceCredential.self, account: trustedDeviceAccount)
    }

    func saveTrustedDevice(_ credential: TrustedDeviceCredential?) {
        saveValue(credential, account: trustedDeviceAccount)
    }

    private func loadValue<Value: Decodable>(_ type: Value.Type, account: String) -> Value? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? decoder.decode(type, from: data)
    }

    private func saveValue<Value: Encodable>(_ value: Value?, account: String) {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        guard let value, let data = try? encoder.encode(value) else {
            SecItemDelete(baseQuery as CFDictionary)
            return
        }

        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = baseQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(addQuery as CFDictionary, nil)
        }
    }
}
